import { type FormEvent, useState } from 'react';
import { useAuth } from '../../lib/auth.js';

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  return (
    <div>
      <h1>SchoolForge</h1>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Accesso…' : 'Accedi'}
        </button>
      </form>
    </div>
  );
}
