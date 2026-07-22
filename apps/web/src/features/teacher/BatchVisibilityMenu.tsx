import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { IconBookOpen, IconCircleX, IconEye, IconEyeOff } from '../../components/icons.js';
import type { BatchReturnVisibilityAction } from '../repository/corrections/batchReturnVisibility.js';
import { ActionsMenu } from './ActionsMenu.js';
import styles from './VerificationsView.module.css';

const ITEMS = [
  { action: 'show_return', label: 'Rendi visibili', Icon: IconEye },
  { action: 'hide_return', label: 'Nascondi allo studente', Icon: IconEyeOff },
  { action: 'show_solutions', label: 'Mostra soluzioni', Icon: IconBookOpen },
  { action: 'hide_solutions', label: 'Nascondi soluzioni', Icon: IconCircleX },
] as const;

export function BatchVisibilityMenu({
  disabled,
  contextKey,
  onSelect,
}: {
  disabled: boolean;
  contextKey: string;
  onSelect: (action: BatchReturnVisibilityAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function close(restoreFocus: boolean) {
    setOpen(false);
    if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    setOpen(false);
  }, [contextKey]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) close(false);
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(true);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function focusItem(position: 'first' | 'last') {
    queueMicrotask(() => {
      const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
      if (!items?.length) return;
      items[position === 'first' ? 0 : items.length - 1]?.focus();
    });
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    setOpen(true);
    focusItem(event.key === 'ArrowDown' ? 'first' : 'last');
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    ];
    const current = items.indexOf(event.currentTarget);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (current + 1) % items.length
            : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <div className={styles.batchMenuCell}>
      <button
        ref={triggerRef}
        type="button"
        className="btn-primary"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onTriggerKeyDown}
      >
        <IconEye />
        Visibilità
      </button>
      <ActionsMenu
        ref={menuRef}
        open={open}
        anchorRef={triggerRef}
        ariaLabel="Azioni visibilità restituzioni"
      >
        {ITEMS.map(({ action, label, Icon }) => (
          <button
            key={action}
            type="button"
            role="menuitem"
            onKeyDown={onMenuKeyDown}
            onClick={() => {
              close(true);
              onSelect(action);
            }}
          >
            <Icon />
            {label}
          </button>
        ))}
      </ActionsMenu>
    </div>
  );
}
