/**
 * M5-05D1 — applicazione **server-side** dei limiti prudenziali DEV nel
 * preflight, prima di acquisire la lease, chiamare il grader o scrivere
 * correzioni. Logica pura: riceve i limiti approvati (dalla config runtime) e i
 * conteggi/stime già calcolati dall'eleggibilità.
 */
import { AiGatewayError } from './aiCorrectionGatewayCore.js';
import type { AiRuntimeLimits } from './aiCorrectionRuntimeConfig.js';

/** Limiti prudenziali DEV di riferimento (M5-05C decision doc §7.1). Non sono
 *  autorizzazione: la config runtime resta la fonte autoritativa a runtime. */
export const DEV_LIMITS: AiRuntimeLimits = {
  maxSubmissionsPerOperation: 30,
  maxOpenQuestionsPerSubmission: 20,
  maxEstimatedTokensPerSubmission: 10_000,
  maxEstimatedTokensPerOperation: 300_000,
  maxProviderConcurrency: 3,
  attemptTimeoutMs: 60_000,
  maxApplicationRetries: 1,
};

export interface OperationLimitInput {
  /** Consegne elaborabili (che genereranno una chiamata provider). */
  eligibleSubmissionCount: number;
  /** Per ogni consegna elaborabile: aperte da valutare e token stimati totali. */
  perSubmission: { openQuestionCount: number; estimatedTokens: number }[];
  /** Token stimati totali dell'operazione. */
  totalEstimatedTokens: number;
}

/**
 * Rifiuta con `AiGatewayError` se un qualsiasi limite è superato. Va invocata
 * **solo** sul percorso provider reale; mock e sole-chiuse non passano di qui.
 */
export function enforceOperationLimits(limits: AiRuntimeLimits, input: OperationLimitInput): void {
  if (input.eligibleSubmissionCount > limits.maxSubmissionsPerOperation) {
    throw new AiGatewayError(
      'limit_exceeded',
      `Troppe consegne elaborabili in una sola operazione (max ${limits.maxSubmissionsPerOperation}).`,
    );
  }
  for (const s of input.perSubmission) {
    if (s.openQuestionCount > limits.maxOpenQuestionsPerSubmission) {
      throw new AiGatewayError(
        'limit_exceeded',
        `Una consegna supera il massimo di domande aperte (max ${limits.maxOpenQuestionsPerSubmission}).`,
      );
    }
    if (s.estimatedTokens > limits.maxEstimatedTokensPerSubmission) {
      throw new AiGatewayError(
        'limit_exceeded',
        `Una consegna supera i token stimati ammessi (max ${limits.maxEstimatedTokensPerSubmission}).`,
      );
    }
  }
  if (input.totalEstimatedTokens > limits.maxEstimatedTokensPerOperation) {
    throw new AiGatewayError(
      'limit_exceeded',
      `L'operazione supera i token stimati ammessi (max ${limits.maxEstimatedTokensPerOperation}).`,
    );
  }
}
