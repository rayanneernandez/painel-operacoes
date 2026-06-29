import { useMemo, useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, Save, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import supabase from '@/lib/supabase';
import { logService } from '@/services/logService';

type SaveStatus = 'idle' | 'success' | 'error';

export function MyAccount() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [message, setMessage] = useState('');

  const passwordRules = useMemo(
    () => ({
      minLength: newPassword.length >= 6,
      matchesConfirmation: !!newPassword && newPassword === confirmPassword,
      changedFromCurrent: !!newPassword && newPassword !== currentPassword,
    }),
    [confirmPassword, currentPassword, newPassword]
  );

  const resetForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  };

  const handleChangePassword = async () => {
    if (!user?.id || !user.email) {
      setStatus('error');
      setMessage('Nao foi possivel identificar o usuario autenticado.');
      return;
    }

    if (!currentPassword || !newPassword || !confirmPassword) {
      setStatus('error');
      setMessage('Preencha a senha atual, a nova senha e a confirmacao.');
      return;
    }

    if (!passwordRules.minLength) {
      setStatus('error');
      setMessage('A nova senha precisa ter pelo menos 6 caracteres.');
      return;
    }

    if (!passwordRules.matchesConfirmation) {
      setStatus('error');
      setMessage('A confirmacao da nova senha nao confere.');
      return;
    }

    if (!passwordRules.changedFromCurrent) {
      setStatus('error');
      setMessage('A nova senha precisa ser diferente da senha atual.');
      return;
    }

    try {
      setIsSaving(true);
      setStatus('idle');
      setMessage('');

      const { data, error } = await supabase
        .from('users')
        .select('id, email, password_hash')
        .eq('id', user.id)
        .single();

      if (error || !data) {
        throw new Error('Nao foi possivel carregar os dados da conta.');
      }

      if (data.password_hash !== currentPassword) {
        throw new Error('A senha atual informada esta incorreta.');
      }

      const { error: updateError } = await supabase
        .from('users')
        .update({ password_hash: newPassword })
        .eq('id', user.id);

      if (updateError) {
        throw updateError;
      }

      await logService.logAction(
        user.email,
        'UPDATE',
        `Usuario ${user.email} alterou a propria senha.`,
        'user',
        user.id,
        { changedField: 'password_hash' }
      );

      resetForm();
      setStatus('success');
      setMessage('Senha alterada com sucesso.');
    } catch (error) {
      console.error('Erro ao alterar a senha do usuario:', error);
      setStatus('error');
      setMessage((error as Error).message || 'Erro ao alterar a senha.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-in fade-in duration-500">
      <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6 shadow-xl backdrop-blur-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-400">
            <User size={24} />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-white">Minha Conta</h1>
            <p className="text-sm text-gray-400">
              Atualize a sua senha sem depender de um administrador.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <KeyRound size={18} className="text-emerald-400" />
              Alterar senha
            </h2>
            <p className="mt-1 text-sm text-gray-400">
              A nova senha sera gravada no banco e usada no proximo login.
            </p>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-950/70 px-4 py-3 text-right">
            <p className="text-xs uppercase tracking-wider text-gray-500">Conta atual</p>
            <p className="mt-1 text-sm font-medium text-white">{user?.name || 'Usuario'}</p>
            <p className="text-xs text-gray-400">{user?.email || ''}</p>
          </div>
        </div>

        <div className="space-y-5">
          <PasswordField
            label="Senha atual"
            value={currentPassword}
            onChange={setCurrentPassword}
            placeholder="Digite sua senha atual"
            visible={showCurrentPassword}
            onToggleVisibility={() => setShowCurrentPassword((value) => !value)}
          />

          <PasswordField
            label="Nova senha"
            value={newPassword}
            onChange={setNewPassword}
            placeholder="Digite a nova senha"
            visible={showNewPassword}
            onToggleVisibility={() => setShowNewPassword((value) => !value)}
          />

          <PasswordField
            label="Confirmar nova senha"
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="Repita a nova senha"
            visible={showConfirmPassword}
            onToggleVisibility={() => setShowConfirmPassword((value) => !value)}
          />
        </div>

        <div className="mt-6 grid gap-3 rounded-2xl border border-gray-800 bg-gray-950/50 p-4 text-sm text-gray-300 md:grid-cols-3">
          <PasswordRule
            label="Minimo de 6 caracteres"
            isValid={passwordRules.minLength}
          />
          <PasswordRule
            label="Senha diferente da atual"
            isValid={passwordRules.changedFromCurrent}
          />
          <PasswordRule
            label="Confirmacao confere"
            isValid={passwordRules.matchesConfirmation}
          />
        </div>

        {message && (
          <div
            className={`mt-6 rounded-xl border px-4 py-3 text-sm ${
              status === 'success'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-red-500/30 bg-red-500/10 text-red-300'
            }`}
          >
            {message}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-gray-800 pt-6">
          <button
            type="button"
            onClick={resetForm}
            disabled={isSaving}
            className="rounded-xl border border-gray-700 bg-gray-950 px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:border-gray-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Limpar
          </button>
          <button
            type="button"
            onClick={handleChangePassword}
            disabled={isSaving}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {isSaving ? 'Salvando...' : 'Salvar nova senha'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  visible,
  onToggleVisibility,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  visible: boolean;
  onToggleVisibility: () => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-gray-300">{label}</label>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-gray-800 bg-gray-950 px-4 py-3 pr-12 text-white outline-none transition-all placeholder:text-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />
        <button
          type="button"
          onClick={onToggleVisibility}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 transition-colors hover:text-white"
          aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
}

function PasswordRule({ label, isValid }: { label: string; isValid: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <ShieldCheck size={16} className={isValid ? 'text-emerald-400' : 'text-gray-600'} />
      <span className={isValid ? 'text-emerald-300' : 'text-gray-400'}>{label}</span>
    </div>
  );
}
