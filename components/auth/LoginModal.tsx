import React, { useState } from 'react';
import { useAuth } from '../../lib/auth';

export default function LoginModal() {
    const { signInWithId } = useAuth();
    const [id, setId] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await signInWithId(id.toUpperCase());
        } catch (err: any) {
            setError(err.message || 'Failed to sign in');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-modal-overlay">
            <div className="login-modal">
                <h2>Welcome to Succes Translator</h2>
                <p className="login-instruction">Enter your Staff ID to continue.</p>

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <input
                            type="text"
                            value={id}
                            onChange={(e) => setId(e.target.value)}
                            placeholder="SIxxxx"
                            disabled={loading}
                            autoFocus
                        />
                    </div>

                    {error && <div className="login-error">{error}</div>}

                    <button type="submit" className="login-button" disabled={loading || !id}>
                        {loading ? 'Verifying...' : 'Enter Console'}
                    </button>
                </form>

                <div className="login-footer">
                    <small>Restricted Access. Authorized Personnel Only.</small>
                </div>
            </div>
        </div>
    );
}
