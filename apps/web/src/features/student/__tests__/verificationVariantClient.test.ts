import type { Functions } from 'firebase/functions';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpsCallable = vi.hoisted(() => vi.fn());
vi.mock('firebase/functions', () => ({ httpsCallable }));

import {
  createAssignVerificationVariant,
  createResolveStudentVerificationPdf,
} from '../verificationVariantClient.js';

describe('verificationVariantClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the exam assignment endpoint with the verification id only', async () => {
    const response = {
      assignmentMode: 'server_resolved',
      assignedQuestionOrders: [0],
      questions: [],
    };
    const call = vi.fn(async () => ({ data: response }));
    httpsCallable.mockReturnValue(call);
    const functions = {} as Functions;

    await expect(
      createAssignVerificationVariant(functions)({ verificationId: 'v1' }),
    ).resolves.toBe(response);
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'assignVerificationVariant');
    expect(call).toHaveBeenCalledWith({ verificationId: 'v1' });
  });

  it('calls the PDF-only endpoint with the verification id only', async () => {
    const response = {
      assignmentMode: 'server_resolved',
      assignedQuestionOrders: [2],
      questions: [],
    };
    const call = vi.fn(async () => ({ data: response }));
    httpsCallable.mockReturnValue(call);
    const functions = {} as Functions;

    await expect(
      createResolveStudentVerificationPdf(functions)({ verificationId: 'v2' }),
    ).resolves.toBe(response);
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'resolveStudentVerificationPdf');
    expect(call).toHaveBeenCalledWith({ verificationId: 'v2' });
  });
});
