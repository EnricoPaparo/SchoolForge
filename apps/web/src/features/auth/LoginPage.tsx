import { type FormEvent, useState } from 'react';
import logoScritta from '../../assets/logo-scritta-schoolforge.png';
import { useAuth } from '../../lib/auth.js';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const { signIn, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
    } catch {
      setError('Credenziali non valide.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleSubmitting(true);
    try {
      await signInWithGoogle();
    } catch {
      setError('Accesso con Google non riuscito. Riprova.');
    } finally {
      setGoogleSubmitting(false);
    }
  };

  const disabled = submitting || googleSubmitting;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <img src={logoScritta} alt="SchoolForge" className={styles.logo} />
        <button
          type="button"
          className={styles.googleBtn}
          onClick={() => void handleGoogleSignIn()}
          disabled={disabled}
        >
          {googleSubmitting ? 'Accesso…' : 'Accedi con Google'}
        </button>
        <div className={styles.divider} role="separator">
          <span>oppure</span>
        </div>
        <form className={styles.form} onSubmit={(e) => void handleSubmit(e)}>
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              disabled={disabled}
            />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              disabled={disabled}
            />
          </div>
          {error && (
            <p role="alert" className={styles.errorMsg}>
              {error}
            </p>
          )}
          <button type="submit" className={`${styles.submitBtn} btn-success`} disabled={disabled}>
            {submitting ? 'Accesso…' : 'Accedi'}
          </button>
        </form>
      </div>
    </div>
  );
}
