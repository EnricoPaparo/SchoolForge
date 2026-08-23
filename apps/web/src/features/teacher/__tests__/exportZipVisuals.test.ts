import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReadTexts = vi.fn();
vi.mock('../../repository/gateway/repositoryGatewayClient.js', () => ({
  readTexts: (...args: unknown[]) => mockReadTexts(...args),
}));

const mockListUdas = vi.fn();
const mockListLessons = vi.fn();
vi.mock('../../repository/programs/programsService.js', () => ({
  listUdas: (...args: unknown[]) => mockListUdas(...args),
  listLessons: (...args: unknown[]) => mockListLessons(...args),
}));

import type JSZip from 'jszip';
import { buildExportZip, type FetchLessonVisuals } from '../exportZip.js';
import { readZipFile } from '../../repository/import/readZipFile.js';
import { validateImport } from '../../repository/validation/validateImport.js';
import type { ProgramItem } from '../../repository/programs/programsService.js';
import type { FirebaseStorage } from 'firebase/storage';
import type { Firestore } from 'firebase/firestore';

/**
 * VISUAL-ENRICHMENT-03C — l'archivio con le immagini.
 *
 * Due esiti sono inaccettabili e questi test esistono per impedirli:
 *
 * 1. un archivio a cui manca in silenzio la figura di una lezione che dichiara
 *    di averla — sembra completo, e l'errore si scopre mesi dopo;
 * 2. un archivio esportato da SchoolForge che SchoolForge non riesce a
 *    reimportare.
 */

const mockStorage = {} as FirebaseStorage;
const mockDb = {} as Firestore;

const ASSET_A = '11111111-2222-4333-8444-555555555555';
const ASSET_B = '99999999-8888-4777-8666-555555555555';

function fileKeys(zip: JSZip): string[] {
  return Object.keys(zip.files).filter((path) => !zip.files[path].dir);
}

const PROGRAM: ProgramItem = {
  id: 'prog-1',
  ownerUid: 'owner-uid',
  title: 'Informatica',
  activeImportId: 'imp-1',
  classIds: [],
  createdAt: null as never,
  updatedAt: null as never,
};

const UDA = {
  id: 'uda-1',
  ownerUid: 'owner-uid',
  importId: 'imp-1',
  dir: 'uda-01-reti',
  filename: 'uda-01-reti.md',
  storageBasePath: 'repository/owner-uid/imports/imp-1/uda-01-reti',
  lessonCount: 2,
};

const MANIFEST = {
  assetId: ASSET_A,
  storageRef: `repository/owner-uid/imp-1/uda-01-reti/visuals/${ASSET_A}.webp`,
  anchor: { headingSlug: 'reti', headingText: 'Reti', placement: 'after-heading' },
  caption: 'Schema',
  altText: 'Diagramma',
  width: 1024,
  height: 1024,
  byteLength: 4,
  sha256: 'a'.repeat(64),
  mimeType: 'image/webp',
  styleVersion: 'schoolforge-sketch/v1',
  sourceBodyHash: 'b'.repeat(64),
  approvedAt: '2026-08-23T10:00:00.000Z',
};

/** Byte arbitrari ma noti: il test confronta l'identità, non il contenuto. */
const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
const WEBP_BASE64 = btoa(String.fromCharCode(...WEBP_BYTES));

function lesson(over: Record<string, unknown> = {}) {
  return {
    id: 'lesson-1',
    ownerUid: 'owner-uid',
    importId: 'imp-1',
    udaDir: 'uda-01-reti',
    path: 'uda-01-reti/lezione-001.md',
    filename: 'lezione-001.md',
    poolStatus: 'absent' as const,
    questionCount: 0,
    storageRef: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-001.md',
    poolStorageRef: null,
    completed: false,
    ...over,
  };
}

const presentItem = (lessonId: string, assetId: string) => ({
  lessonId,
  status: 'present' as const,
  assetId,
  manifestJson: `${JSON.stringify({ ...MANIFEST, assetId }, null, 2)}\n`,
  base64: WEBP_BASE64,
  byteLength: WEBP_BYTES.byteLength,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockReadTexts.mockImplementation(async (paths: string[]) =>
    paths.map((path) => ({ ok: true, path, content: '# contenuto\n' })),
  );
});

describe('export ZIP — lezioni senza visual', () => {
  /**
   * La regressione che conta di più: chi non usa la funzione non deve
   * accorgersi che esiste, né nell'archivio né nelle operazioni.
   */
  it('produce lo stesso archivio di prima e non chiama l’operazione binaria', async () => {
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([lesson()]);
    const fetchVisuals = vi.fn();

    const zip = await buildExportZip(PROGRAM, mockStorage, mockDb, fetchVisuals as never);

    expect(fileKeys(zip)).toEqual(['uda-01-reti/uda-01-reti.md', 'uda-01-reti/lezione-001.md']);
    expect(fetchVisuals).not.toHaveBeenCalled();
  });

  it('non chiama nulla nemmeno con visual esplicitamente null', async () => {
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([lesson({ visual: null })]);
    const fetchVisuals = vi.fn();

    await buildExportZip(PROGRAM, mockStorage, mockDb, fetchVisuals as never);
    expect(fetchVisuals).not.toHaveBeenCalled();
  });
});

describe('export ZIP — sidecar visuali', () => {
  it('aggiunge JSON e WebP dopo i file didattici, senza toccarli', async () => {
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([lesson({ visual: MANIFEST })]);
    const fetchVisuals: FetchLessonVisuals = async () => [presentItem('lesson-1', ASSET_A)];

    const zip = await buildExportZip(PROGRAM, mockStorage, mockDb, fetchVisuals);

    expect(fileKeys(zip)).toEqual([
      'uda-01-reti/uda-01-reti.md',
      'uda-01-reti/lezione-001.md',
      `visuals/${ASSET_A}.json`,
      `visuals/${ASSET_A}.webp`,
    ]);
  });

  /** Prova byte-per-byte: ciò che esce dallo ZIP è ciò che è entrato. */
  it('scrive il WebP byte per byte identico a quello ricevuto', async () => {
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([lesson({ visual: MANIFEST })]);
    const fetchVisuals: FetchLessonVisuals = async () => [presentItem('lesson-1', ASSET_A)];

    const zip = await buildExportZip(PROGRAM, mockStorage, mockDb, fetchVisuals);
    const bytes = await zip.file(`visuals/${ASSET_A}.webp`)!.async('uint8array');

    expect(Array.from(bytes)).toEqual(Array.from(WEBP_BYTES));
  });

  it('scrive il manifest esattamente come serializzato dal server', async () => {
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([lesson({ visual: MANIFEST })]);
    const item = presentItem('lesson-1', ASSET_A);
    const fetchVisuals: FetchLessonVisuals = async () => [item];

    const zip = await buildExportZip(PROGRAM, mockStorage, mockDb, fetchVisuals);
    const json = await zip.file(`visuals/${ASSET_A}.json`)!.async('string');

    expect(json).toBe(item.manifestJson);
    expect(json).not.toContain('http');
    expect(json).not.toContain('token');
  });

  it('chiede soltanto le lezioni che dichiarano un visual, in ordine', async () => {
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([
      lesson({ id: 'a', filename: 'lezione-001.md', visual: MANIFEST, order: 0 }),
      lesson({ id: 'b', filename: 'lezione-002.md', order: 1 }),
      lesson({ id: 'c', filename: 'lezione-003.md', visual: MANIFEST, order: 2 }),
    ]);
    const fetchVisuals: FetchLessonVisuals = vi.fn(async () => [
      presentItem('a', ASSET_A),
      presentItem('c', ASSET_B),
    ]);

    await buildExportZip(PROGRAM, mockStorage, mockDb, fetchVisuals);

    expect(fetchVisuals).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchVisuals).mock.calls[0]?.[0]).toEqual({
      programId: 'prog-1',
      importId: 'imp-1',
      lessonIds: ['a', 'c'],
    });
  });
});

describe('export ZIP — fail-closed su un visual dichiarato', () => {
  const seedOne = () => {
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([lesson({ visual: MANIFEST })]);
  };

  /**
   * Il caso centrale: la lezione dichiara un'immagine e il server non riesce a
   * consegnarla verificata. Ignorarlo produrrebbe un archivio che sembra
   * completo — il modo peggiore di perdere un dato.
   */
  it('fallisce se il server non consegna il visual dichiarato', async () => {
    seedOne();
    const fetchVisuals: FetchLessonVisuals = async () => [
      { lessonId: 'lesson-1', status: 'absent' },
    ];
    await expect(buildExportZip(PROGRAM, mockStorage, mockDb, fetchVisuals)).rejects.toThrow(
      /non è disponibile/,
    );
  });

  it('fallisce se un risultato manca', async () => {
    seedOne();
    const fetchVisuals: FetchLessonVisuals = async () => [];
    await expect(buildExportZip(PROGRAM, mockStorage, mockDb, fetchVisuals)).rejects.toThrow(
      /non copre tutte/,
    );
  });

  it('fallisce se i risultati arrivano fuori ordine', async () => {
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([
      lesson({ id: 'a', visual: MANIFEST }),
      lesson({ id: 'b', filename: 'lezione-002.md', visual: MANIFEST }),
    ]);
    const fetchVisuals: FetchLessonVisuals = async () => [
      presentItem('b', ASSET_B),
      presentItem('a', ASSET_A),
    ];
    await expect(buildExportZip(PROGRAM, mockStorage, mockDb, fetchVisuals)).rejects.toThrow(
      /ordine/,
    );
  });

  it('fallisce se l’errore del gateway si propaga', async () => {
    seedOne();
    const fetchVisuals: FetchLessonVisuals = async () => {
      throw new Error('gateway giù');
    };
    await expect(buildExportZip(PROGRAM, mockStorage, mockDb, fetchVisuals)).rejects.toThrow(
      /gateway giù/,
    );
  });

  it('fallisce se i byte non corrispondono a quanto dichiarato', async () => {
    seedOne();
    const fetchVisuals: FetchLessonVisuals = async () => [
      { ...presentItem('lesson-1', ASSET_A), byteLength: 999 },
    ];
    await expect(buildExportZip(PROGRAM, mockStorage, mockDb, fetchVisuals)).rejects.toThrow(
      /non corrispondono/,
    );
  });

  it('fallisce su un assetId non canonico invece di comporre un percorso', async () => {
    seedOne();
    const fetchVisuals: FetchLessonVisuals = async () => [
      { ...presentItem('lesson-1', ASSET_A), assetId: '../../fuori' },
    ];
    await expect(buildExportZip(PROGRAM, mockStorage, mockDb, fetchVisuals)).rejects.toThrow(
      /non valido/,
    );
  });

  /**
   * `JSZip.file()` sovrascrive in silenzio: due lezioni che dichiarassero lo
   * stesso assetId produrrebbero un archivio a cui manca una figura.
   */
  it('fallisce se due lezioni producono lo stesso percorso visuale', async () => {
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([
      lesson({ id: 'a', visual: MANIFEST }),
      lesson({ id: 'b', filename: 'lezione-002.md', visual: MANIFEST }),
    ]);
    const fetchVisuals: FetchLessonVisuals = async () => [
      presentItem('a', ASSET_A),
      presentItem('b', ASSET_A),
    ];
    await expect(buildExportZip(PROGRAM, mockStorage, mockDb, fetchVisuals)).rejects.toThrow(
      /Collisione/,
    );
  });
});

describe('round-trip — export con visual, reimport senza', () => {
  /**
   * L'archivio esportato deve poter rientrare. `visuals/` è una directory di
   * primo livello, e per `validateImport` una directory di primo livello è una
   * UDA: senza l'esclusione esplicita l'import fallirebbe con `MISSING_UDA_FILE`
   * su una UDA che non esiste.
   */
  async function roundTrip(wrapInFolder: boolean) {
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([lesson({ visual: MANIFEST })]);
    mockReadTexts.mockImplementation(async (paths: string[]) =>
      paths.map((path) => ({
        ok: true,
        path,
        content: path.includes('uda-01-reti.md')
          ? '---\ntitolo: Reti\n---\n\n# Reti\n'
          : '---\ntitolo: Lezione\n---\n\n# Lezione\n',
      })),
    );
    const fetchVisuals: FetchLessonVisuals = async () => [presentItem('lesson-1', ASSET_A)];
    const zip = await buildExportZip(PROGRAM, mockStorage, mockDb, fetchVisuals);

    const inner = wrapInFolder ? new (await import('jszip')).default() : zip;
    if (wrapInFolder) {
      for (const path of fileKeys(zip)) {
        inner.file(`Corso/${path}`, await zip.file(path)!.async('uint8array'));
      }
    }
    const blob = await inner.generateAsync({ type: 'arraybuffer' });
    const file = new File([blob], 'export.zip', { type: 'application/zip' });
    return readZipFile(file);
  }

  it('l’import ignora del tutto i file visuali', async () => {
    const files = await roundTrip(false);
    expect(files.map((f) => f.path)).toEqual([
      'uda-01-reti/uda-01-reti.md',
      'uda-01-reti/lezione-001.md',
    ]);
    expect(files.some((f) => f.path.startsWith('visuals/'))).toBe(false);
  });

  /** Il caso più comune: «zippa la cartella» aggiunge un wrapper. */
  it('li ignora anche quando l’archivio è avvolto in una cartella', async () => {
    const files = await roundTrip(true);
    expect(files.some((f) => f.path.includes('visuals/'))).toBe(false);
    expect(files.map((f) => f.path)).toEqual([
      'uda-01-reti/uda-01-reti.md',
      'uda-01-reti/lezione-001.md',
    ]);
  });

  it('la struttura didattica supera la validazione come oggi', async () => {
    const files = await roundTrip(false);
    const result = validateImport('Informatica', files);
    expect(result.issues.filter((i) => i.code === 'MISSING_UDA_FILE')).toEqual([]);
    expect(result.udas).toHaveLength(1);
  });

  /** Nessun campo visual entra dall'archivio: si nasce senza immagine. */
  it('nessun dato visuale raggiunge il payload di import', async () => {
    const files = await roundTrip(false);
    const serialized = JSON.stringify(files);
    expect(serialized).not.toContain(ASSET_A);
    expect(serialized).not.toContain('sourceBodyHash');
    expect(serialized).not.toContain('storageRef');
  });
});
