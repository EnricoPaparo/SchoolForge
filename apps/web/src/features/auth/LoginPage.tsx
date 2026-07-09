import { useState } from 'react';
import logoScritta from '../../assets/logo-scritta-schoolforge.png';
import { useAuth } from '../../lib/auth.js';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const { signInWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

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

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <img src={logoScritta} alt="SchoolForge" className={styles.logo} />
        <button
          type="button"
          className={styles.googleBtn}
          onClick={() => void handleGoogleSignIn()}
          disabled={googleSubmitting}
        >
          {googleSubmitting ? 'Accesso…' : 'Accedi con Google'}
        </button>
        {error && (
          <p role="alert" className={styles.errorMsg}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
