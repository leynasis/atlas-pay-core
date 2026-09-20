import React, { useState } from "react";
import { Download, LockKeyhole, LoaderCircle } from "lucide-react";

export default function WalletBackup({
  locale,
  csrfToken,
  connected,
  currency,
}) {
  const ru = locale === "ru";
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  if (currency !== "LAVE") return null;
  async function download(event) {
    event.preventDefault();
    setMessage(null);
    if (password !== confirmation) {
      setMessage({
        error: true,
        text: ru ? "Пароли не совпадают." : "Passwords do not match.",
      });
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/wallet/backup", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(
          body.error?.message ||
            (ru ? "Не удалось создать копию." : "Backup export failed."),
        );
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download =
        /filename="([a-zA-Z0-9_.-]+)"/.exec(
          response.headers.get("Content-Disposition") || "",
        )?.[1] || "lave-wallet.lavebackup";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setMessage({
        error: false,
        text: ru
          ? "Зашифрованная копия готова. Сохраните файл и пароль в разных безопасных местах."
          : "Encrypted backup ready. Keep the file and password in separate safe places.",
      });
    } catch (error) {
      setMessage({ error: true, text: error.message });
    } finally {
      setPassword("");
      setConfirmation("");
      setBusy(false);
    }
  }
  return (
    <section className="wallet-backup">
      <h3>
        <LockKeyhole size={17} />
        {ru ? "Резервная копия" : "Wallet backup"}
      </h3>
      <p>
        {ru
          ? "Ключи кошелька и журнал подписей в одном зашифрованном файле."
          : "Wallet keys and signing history in one encrypted file."}
      </p>
      <form onSubmit={download}>
        <label htmlFor="backup-password">
          {ru ? "Новый пароль копии" : "New backup password"}
        </label>
        <input
          id="backup-password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={256}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={ru ? "Не менее 12 символов" : "At least 12 characters"}
          disabled={busy}
        />
        <label htmlFor="backup-confirmation">
          {ru ? "Повторите пароль" : "Confirm password"}
        </label>
        <input
          id="backup-confirmation"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={256}
          required
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          disabled={busy}
        />
        <button
          className="button secondary"
          disabled={busy || !connected || !csrfToken}
        >
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Download size={16} />
          )}
          {busy
            ? ru
              ? "Создаём копию…"
              : "Creating backup…"
            : ru
              ? "Скачать копию"
              : "Download backup"}
        </button>
      </form>
      {message && (
        <p
          className={message.error ? "error" : "backup-success"}
          role={message.error ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
      <details>
        <summary>{ru ? "Как восстановить" : "How recovery works"}</summary>
        <p>
          {ru
            ? "Восстановление выполняется локальной командой в новый каталог. История платежей проверяется до возобновления работы; новые подписи в восстановленной копии заблокированы. Пароль не сохраняется в приложении — без него копию открыть нельзя."
            : "Restore locally into a new directory using the recovery command. Reconcile payment history before resuming; new signatures in the recovered copy remain locked. The app does not save your password, and recovery requires it."}
        </p>
      </details>
    </section>
  );
}
