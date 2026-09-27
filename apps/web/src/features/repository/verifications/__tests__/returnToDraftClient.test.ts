import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createReturnVerificationToDraft,
  describeReturnToDraftError,
  RETURN_TO_DRAFT_SUBMISSION_ERROR,
} from '../returnToDraftClient.js';

const callable = vi.hoisted(() => vi.fn());
const httpsCallable = vi.hoisted(() => vi.fn(() => callable));
vi.mock('firebase/functions', () => ({ httpsCallable }));

describe('returnToDraftClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls the single authoritative callable with only the verification id', async () => {
    callable.mockResolvedValue({ data: { status: 'draft' } });
    const functions = {} as never;
    await createReturnVerificationToDraft(functions)('verification-1');
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'returnVerificationToDraft');
    expect(callable).toHaveBeenCalledWith({ verificationId: 'verification-1' });
  });

  it('keeps the submissions blocker explicit and concise', () => {
    expect(
      describeReturnToDraftError({
        code: 'functions/failed-precondition',
        message: `FAILED_PRECONDITION: ${RETURN_TO_DRAFT_SUBMISSION_ERROR}`,
      }),
    ).toBe(RETURN_TO_DRAFT_SUBMISSION_ERROR);
  });
});
