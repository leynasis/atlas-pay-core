import { currencyFor, profileFor, walletStorageKey } from "./currency.js";
import React, { useCallback, useEffect, useRef, useState } from "react";
import Brand from "./Brand.jsx";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  ExternalLink,
  FlaskConical,
  Globe2,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";

const dictionary = {
  en: {
    customer: "Customer wallet",
    merchant: "Merchant wallet",
    eyebrow: "LAVEPAY / YOUR APPROVAL",
    title: "Review first.\nSign when ready.",
    subtitle:
      "This wallet signs only after your explicit approval on this page.",
    test: "LOCAL DEVNET · TEST COINS",
    balance: "Confirmed balance",
    pendingBalance: "Pending balance",
    receive: "Your receiving address",
    receiveHelp:
      "Use this address to receive test {currency} or a refund on this local network.",
    connected: "Wallet node connected",
    offline: "Wallet node unavailable",
    checking: "Connecting to wallet",
    home: "Merchant workspace",
    back: "Back to invoice",
    import: "Import invoice",
    invoice: "Invoice ID",
    prepare: "Prepare for review",
    preparing: "Preparing transaction…",
    emptyTitle: "A payment needs your approval.",
    emptyBody:
      "Open an invoice from the merchant workspace, or enter its ID. Preparing a transaction does not sign or send it.",
    payment: "Payment",
    refund: "Refund",
    request: "Request",
    review: "Review transaction",
    approval: "Awaiting your approval",
    merchantLabel: "Merchant name",
    unverified: "Provided by the request · Identity not verified",
    description: "Description",
    network: "Network",
    recipient: "Recipient address",
    amount: "Amount",
    fee: "Network fee",
    total: "Total debit",
    change: "Change returned",
    changeAddress: "Change address",
    changeNote: "Change remains in this wallet.",
    expires: "Request expires",
    fingerprint: "Review fingerprint",
    genesis: "Network identity",
    baseGenesis: "Base genesis",
    devnetGenesis: "Devnet genesis",
    sign: "Sign and send",
    signing: "Processing approval…",
    cancel: "Cancel request",
    cancelling: "Cancelling…",
    copy: "Copy",
    copied: "Copied",
    copyFailed: "Copy failed. Select and copy the value manually.",
    error: "The wallet could not complete this action.",
    statusError: "Unable to refresh wallet status.",
    retryTransaction: "Retry same transaction",
    reload: "Refresh status",
    waiting:
      "The transaction is being processed. Do not create another payment.",
    unknown:
      "Transaction status needs reconciliation. Refresh the status before taking another action.",
    broadcast: "Transaction sent",
    confirmed: "Transaction confirmed",
    pending: "Awaiting a block",
    conflicted: "Transaction conflicted",
    cancelled: "Request cancelled",
    cancelledBody:
      "This request is permanently cancelled. Create a new invoice to make a new payment. Reloading this page never starts signing.",
    expired: "This request has expired and cannot be approved.",
    txid: "Transaction ID",
    confirmations: "Confirmations",
    mempool: "In mempool",
    yes: "Yes",
    no: "No",
    unknownLabel: "Unknown",
    receipt: "Merchant receipt registration",
    receiptSynced: "Registered",
    receiptPending: "Pending registration",
    refundReceipt:
      "The merchant invoice updates after the refund transaction is registered.",
    pendingHelp:
      "Return to the invoice to create a local test block. The wallet will show the chain confirmation here.",
    approveHelp:
      "Check the network, recipient, amount and fee. Clicking below explicitly authorizes this wallet to sign and broadcast this transaction.",
    localBoundary:
      "A separate local wallet service. No mainnet funds; no InstantSend or ChainLocks.",
    restore: "Request restored. Approval is always a separate action.",
    notCurrent:
      "The chain is unavailable. Transaction state may be out of date.",
    stale:
      "Data could not be refreshed. Signing is disabled until the connection is restored.",
    newRequest: "Open another invoice",
    manualState:
      "This operation is unfinished. If the state persists after a service restart, the wallet requires manual inspection; a second approval is not available.",
    stateLabel: "Wallet request state",
    signerHelp:
      "The merchant server cannot approve this wallet’s transactions.",
    kindError: "This wallet cannot process that request type.",
    noAddress: "Unavailable",
    prepared: "Prepared",
    awaiting_approval: "Awaiting approval",
    preparingState: "Preparing",
    preparation_uncertain: "Preparation uncertain",
    signingState: "Signing",
    signed: "Signed",
    broadcasting: "Broadcasting",
    broadcast_unknown: "Broadcast not yet verified",
    broadcastState: "Broadcast",
    cancelledState: "Cancelled",
    invalidInvoice: "Enter the invoice ID.",
  },
  ru: {
    customer: "Кошелёк покупателя",
    merchant: "Кошелёк продавца",
    eyebrow: "LAVEPAY / ВАШЕ ОДОБРЕНИЕ",
    title: "Сначала проверьте.\nЗатем подпишите.",
    subtitle:
      "Кошелёк подписывает транзакцию только после вашего явного одобрения на этой странице.",
    test: "ЛОКАЛЬНАЯ DEVNET · ТЕСТОВЫЕ МОНЕТЫ",
    balance: "Подтверждённый баланс",
    pendingBalance: "Ожидающий баланс",
    receive: "Ваш адрес для получения",
    receiveHelp:
      "Используйте этот адрес для получения тестовых {currency} или возврата в этой локальной сети.",
    connected: "Узел кошелька подключён",
    offline: "Узел кошелька недоступен",
    checking: "Подключение к кошельку",
    home: "Кабинет продавца",
    back: "Вернуться к счёту",
    import: "Импорт счёта",
    invoice: "ID счёта",
    prepare: "Подготовить к проверке",
    preparing: "Подготовка транзакции…",
    emptyTitle: "Платёж ждёт вашего решения.",
    emptyBody:
      "Откройте счёт из кабинета продавца или введите его ID. Подготовка транзакции не подписывает и не отправляет её.",
    payment: "Платёж",
    refund: "Возврат",
    request: "Запрос",
    review: "Проверка транзакции",
    approval: "Ожидает вашего одобрения",
    merchantLabel: "Название продавца",
    unverified: "Указано в запросе · Личность не проверена",
    description: "Описание",
    network: "Сеть",
    recipient: "Адрес получателя",
    amount: "Сумма",
    fee: "Комиссия сети",
    total: "Всего к списанию",
    change: "Возвращаемая сдача",
    changeAddress: "Адрес сдачи",
    changeNote: "Сдача остаётся в этом кошельке.",
    expires: "Запрос истекает",
    fingerprint: "Отпечаток проверяемых данных",
    genesis: "Идентификаторы сети",
    baseGenesis: "Базовый генезис",
    devnetGenesis: "Генезис devnet",
    sign: "Подписать и отправить",
    signing: "Обработка одобрения…",
    cancel: "Отменить запрос",
    cancelling: "Отмена…",
    copy: "Копировать",
    copied: "Скопировано",
    copyFailed:
      "Не удалось скопировать. Выделите и скопируйте значение вручную.",
    error: "Кошелёк не смог выполнить действие.",
    statusError: "Не удалось обновить состояние кошелька.",
    retryTransaction: "Повторить отправку той же транзакции",
    reload: "Обновить состояние",
    waiting: "Транзакция обрабатывается. Не создавайте повторный платёж.",
    unknown:
      "Состояние транзакции требует сверки. Обновите его перед следующим действием.",
    broadcast: "Транзакция отправлена",
    confirmed: "Транзакция подтверждена",
    pending: "Ожидает блока",
    conflicted: "Конфликт транзакции",
    cancelled: "Запрос отменён",
    cancelledBody:
      "Этот запрос отменён окончательно. Для нового платежа создайте новый счёт. Перезагрузка страницы никогда не запускает подписание.",
    expired: "Срок запроса истёк. Его нельзя одобрить.",
    txid: "ID транзакции",
    confirmations: "Подтверждения",
    mempool: "В мемпуле",
    yes: "Да",
    no: "Нет",
    unknownLabel: "Неизвестно",
    receipt: "Регистрация возврата у продавца",
    receiptSynced: "Зарегистрирован",
    receiptPending: "Ожидает регистрации",
    refundReceipt:
      "Счёт продавца обновится после регистрации транзакции возврата.",
    pendingHelp:
      "Вернитесь к счёту и создайте локальный тестовый блок. Подтверждение сети появится здесь.",
    approveHelp:
      "Проверьте сеть, получателя, сумму и комиссию. Нажатие кнопки явно разрешает этому кошельку подписать и отправить транзакцию.",
    localBoundary:
      "Отдельный локальный сервис кошелька. Без средств основной сети, InstantSend и ChainLocks.",
    restore:
      "Запрос восстановлен. Одобрение всегда выполняется отдельным действием.",
    notCurrent:
      "Цепочка недоступна. Состояние транзакции может быть устаревшим.",
    stale:
      "Не удалось обновить данные. Подписание отключено до восстановления связи.",
    newRequest: "Открыть другой счёт",
    manualState:
      "Операция не завершена. Если состояние сохраняется после перезапуска сервиса, кошелёк требует ручной проверки; повторное одобрение недоступно.",
    stateLabel: "Состояние запроса кошелька",
    signerHelp: "Сервер продавца не может одобрять транзакции этого кошелька.",
    kindError: "Этот кошелёк не поддерживает такой тип запроса.",
    noAddress: "Недоступно",
    prepared: "Подготовлен",
    awaiting_approval: "Ожидает одобрения",
    preparingState: "Подготовка",
    preparation_uncertain: "Подготовка не завершена",
    signingState: "Подписание",
    signed: "Подписан",
    broadcasting: "Отправка",
    broadcast_unknown: "Отправка ещё не проверена",
    broadcastState: "Отправлен",
    cancelledState: "Отменён",
    invalidInvoice: "Введите ID счёта.",
  },
};
const legacyStorageKey = "atlas-wallet-active-v1";
function initialContext() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const role = location.port === "4175" ? "merchant" : "customer";
  return {
    role,
    invoiceId: fragment.get("invoice") || "",
    kind: fragment.get("kind") || (role === "merchant" ? "refund" : "payment"),
    requestId: null,
  };
}
function WalletCopy({ label, value, t }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setError(false);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(true);
    }
  }
  return (
    <div className="wallet-copy">
      <span>{label}</span>
      <div>
        <code>{value || t.noAddress}</code>
        {value && (
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? t.copied : t.copy}
            title={copied ? t.copied : t.copy}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        )}
      </div>
      {error && <small role="status">{t.copyFailed}</small>}
    </div>
  );
}
export default function WalletApp() {
  const [context] = useState(initialContext),
    [locale, setLocale] = useState(
      () =>
        localStorage.getItem("atlas-language") ||
        (navigator.language.startsWith("ru") ? "ru" : "en"),
    );
  const t = dictionary[locale] || dictionary.en;
  const [status, setStatus] = useState(null),
    [review, setReview] = useState(null),
    [invoiceId, setInvoiceId] = useState(context.invoiceId),
    [requestId, setRequestId] = useState(context.requestId),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [fetchError, setFetchError] = useState(""),
    [loading, setLoading] = useState(true),
    [restored, setRestored] = useState(Boolean(context.requestId));
  const csrf = useRef(null),
    mutation = useRef(false),
    polling = useRef(false),
    storageScope = useRef(null),
    activeId = useRef(requestId);
  activeId.current = requestId;
  const role = status?.role || context.role;
  const kind = context.kind;
  useEffect(() => {
    localStorage.setItem("atlas-language", locale);
    document.documentElement.lang = locale;
  }, [locale]);
  async function get(path) {
    const response = await fetch("/api/wallet" + path, {
      credentials: "same-origin",
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error?.message || `HTTP ${response.status}`);
    return result;
  }
  async function post(path, body) {
    if (!csrf.current) throw new Error(t.statusError);
    const response = await fetch("/api/wallet" + path, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf.current,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error?.message || `HTTP ${response.status}`);
    return result;
  }
  const refresh = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const result = await get("/status");
      const scope = walletStorageKey(result);
      if (!scope) throw new Error(t.statusError);
      if (storageScope.current !== scope) {
        storageScope.current = scope;
        activeId.current = null;
        setRequestId(null);
        setReview(null);
        setInvoiceId(context.invoiceId);
        setRestored(false);
        let saved;
        try {
          saved = JSON.parse(localStorage.getItem(scope) || "null");
          // Only the explicitly identified old Atlas profile may import its
          // pre-profile browser bookmark; LAVE must never restore an Atlas ID.
          if (!saved && profileFor(result) === "atlas") {
            saved = JSON.parse(
              localStorage.getItem(legacyStorageKey) || "null",
            );
            if (saved) localStorage.setItem(scope, JSON.stringify(saved));
          }
        } catch {}
        if (
          saved?.requestId &&
          (!context.invoiceId || saved.invoiceId === context.invoiceId)
        ) {
          activeId.current = saved.requestId;
          setRequestId(saved.requestId);
          setInvoiceId(saved.invoiceId);
          setRestored(true);
        }
      }
      setStatus(result);
      csrf.current = result.csrfToken;
      if (activeId.current) {
        const requestedId = activeId.current;
        const data = await get("/requests/" + encodeURIComponent(requestedId));
        if (activeId.current === requestedId && storageScope.current === scope)
          setReview(data.review);
      }
      setFetchError("");
    } catch (err) {
      setFetchError(err.message);
    } finally {
      polling.current = false;
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  async function action(which, event) {
    event?.preventDefault();
    if (mutation.current) return;
    if (which === "prepare" && !invoiceId.trim()) {
      setError(t.invalidInvoice);
      return;
    }
    mutation.current = true;
    setBusy(which);
    setError("");
    try {
      let result;
      if (which === "prepare") {
        if (
          (role === "customer" && kind !== "payment") ||
          (role === "merchant" && kind !== "refund")
        )
          throw new Error(t.kindError);
        result = await post("/prepare", { invoiceId: invoiceId.trim(), kind });
        const id = result.review.id;
        activeId.current = id;
        setRequestId(id);
        localStorage.setItem(
          storageScope.current,
          JSON.stringify({ requestId: id, invoiceId: invoiceId.trim(), kind }),
        );
        setRestored(false);
      } else if (which === "approve")
        result = await post("/approve", {
          requestId: review.id,
          fingerprint: review.fingerprint,
        });
      else result = await post("/cancel", { requestId: review.id });
      setReview(result.review);
      await refresh();
    } catch (err) {
      setError(err.message || t.error);
      if (activeId.current) {
        try {
          const latest = await get(
            "/requests/" + encodeURIComponent(activeId.current),
          );
          setReview(latest.review);
        } catch (refreshFailure) {
          setFetchError(refreshFailure.message);
        }
      }
      await refresh();
    } finally {
      mutation.current = false;
      setBusy("");
    }
  }
  const connected = status?.chainAvailable === true && !fetchError;
  const network = review?.network || status?.network;
  const currency = currencyFor(review, status);
  const balanceCurrency = currencyFor(status);
  const networkName = network?.devnetName || network?.chain || "—";
  const expired =
    review?.expiresAt && Date.parse(review.expiresAt) <= Date.now();
  const ready = review && review.state === "prepared";
  const canApprove =
    ready && !expired && connected && review.chainAvailable !== false && !busy;
  const broadcast =
    review &&
    ([
      "broadcast",
      "broadcast_unknown",
      "broadcasting",
      "signed",
      "signing",
    ].includes(review.state) ||
      review.txid);
  const confirmed = review?.confirmationState === "confirmed";
  const cancelled = review?.state === "cancelled";
  const stateLabel = review
    ? {
        preparing: t.preparingState,
        signing: t.signingState,
        broadcast: t.broadcastState,
        cancelled: t.cancelledState,
      }[review.state] ||
      t[review.state] ||
      review.state
    : "";
  const backUrl =
    review?.invoiceId || invoiceId
      ? "http://127.0.0.1:4173/pay/" +
        encodeURIComponent(review?.invoiceId || invoiceId)
      : "http://127.0.0.1:4173/";
  return (
    <div className="wallet-app">
      <header className="wallet-header">
        <Brand href="http://127.0.0.1:4173/" />
        <div className="wallet-header-right">
          <span className="wallet-role-pill">
            <Wallet size={14} />
            {t[role]}
          </span>
          <div className="language-switch">
            <Globe2 size={14} />
            <button
              aria-pressed={locale === "en"}
              onClick={() => setLocale("en")}
            >
              EN
            </button>
            <span>/</span>
            <button
              aria-pressed={locale === "ru"}
              onClick={() => setLocale("ru")}
            >
              RU
            </button>
          </div>
        </div>
      </header>
      <div className="test-banner">
        <FlaskConical size={14} />
        <strong>{t.test}</strong>
      </div>
      <main className="wallet-shell">
        <a href={backUrl} className="back-link">
          <ArrowLeft size={13} />
          {invoiceId ? t.back : t.home}
        </a>
        <section className="wallet-page-heading">
          <div>
            <div className="eyebrow">{t.eyebrow}</div>
            <h1>{t.title}</h1>
            <p>{t.subtitle}</p>
          </div>
          <span className={"node-status " + (connected ? "online" : "offline")}>
            <i />
            {loading ? t.checking : connected ? t.connected : t.offline}
          </span>
        </section>
        {fetchError && (
          <div className="error wallet-error" role="alert">
            <CircleAlert size={18} />
            <div>
              <strong>{t.stale}</strong>
              <small>{fetchError}</small>
            </div>
            <button onClick={refresh}>{t.reload}</button>
          </div>
        )}
        <div className="wallet-layout">
          <section className="wallet-transaction">
            <div className="wallet-card-header">
              <span>
                <ShieldCheck size={19} />
                {review ? t.review : t.import}
              </span>
              <span className="wallet-kind">{t[kind] || kind}</span>
            </div>
            {loading && requestId ? (
              <div className="loading-card">
                <LoaderCircle className="spin" size={20} />
                {t.checking}
              </div>
            ) : !review ? (
              <div className="wallet-import">
                <div className="wallet-empty-icon">
                  <Wallet size={27} />
                </div>
                <h2>{t.emptyTitle}</h2>
                <p>{t.emptyBody}</p>
                <form onSubmit={(event) => action("prepare", event)}>
                  <label htmlFor="wallet-invoice">{t.invoice}</label>
                  <input
                    id="wallet-invoice"
                    value={invoiceId}
                    onChange={(event) => setInvoiceId(event.target.value)}
                    maxLength={150}
                    required
                    autoComplete="off"
                  />
                  <button
                    className="button"
                    type="submit"
                    disabled={!!busy || !connected || !invoiceId.trim()}
                  >
                    {busy === "prepare" ? (
                      <LoaderCircle size={17} className="spin" />
                    ) : (
                      <ArrowRight size={17} />
                    )}{" "}
                    {busy === "prepare" ? t.preparing : t.prepare}
                  </button>
                </form>
              </div>
            ) : (
              <div className="wallet-review">
                {restored && (
                  <p className="wallet-restored">
                    <RefreshCw size={13} />
                    {t.restore}
                  </p>
                )}
                <div
                  className={
                    "wallet-lifecycle " +
                    (confirmed
                      ? "is-confirmed"
                      : cancelled
                        ? "is-cancelled"
                        : "")
                  }
                >
                  <span className="wallet-lifecycle-icon">
                    {confirmed ? (
                      <ShieldCheck size={24} />
                    ) : cancelled ? (
                      <X size={22} />
                    ) : (
                      <LockKeyhole size={22} />
                    )}
                  </span>
                  <div>
                    <strong>
                      {confirmed
                        ? t.confirmed
                        : review.confirmationState === "conflicted"
                          ? t.conflicted
                          : cancelled
                            ? t.cancelled
                            : review.state === "broadcast"
                              ? t.broadcast
                              : ready
                                ? t.approval
                                : stateLabel}
                    </strong>
                    <span>
                      {t.stateLabel}: {stateLabel}
                    </span>
                  </div>
                </div>
                <dl className="wallet-review-meta">
                  <div>
                    <dt>{t.merchantLabel}</dt>
                    <dd>
                      {review.merchantName || "—"}
                      <small>{t.unverified}</small>
                    </dd>
                  </div>
                  <div>
                    <dt>{t.description}</dt>
                    <dd>{review.description || "—"}</dd>
                  </div>
                  <div>
                    <dt>{t.network}</dt>
                    <dd>
                      <span className="wallet-network-tag">{networkName}</span>
                    </dd>
                  </div>
                </dl>
                <WalletCopy label={t.recipient} value={review.address} t={t} />
                <div className="wallet-amounts">
                  <div>
                    <span>{t.amount}</span>
                    <strong>
                      {review.amount ?? "—"} <small>{currency}</small>
                    </strong>
                  </div>
                  <div>
                    <span>{t.fee}</span>
                    <strong>
                      {review.fee ?? "—"} <small>{currency}</small>
                    </strong>
                  </div>
                  <div className="wallet-total">
                    <span>{t.total}</span>
                    <strong>
                      {review.total ?? "—"} <small>{currency}</small>
                    </strong>
                  </div>
                </div>
                <div className="wallet-change">
                  <span>
                    {t.change}
                    <small>{t.changeNote}</small>
                  </span>
                  <strong>
                    {review.changeAmount ?? "—"} {currency}
                  </strong>
                </div>
                {review.changeAddress && (
                  <WalletCopy
                    label={t.changeAddress}
                    value={review.changeAddress}
                    t={t}
                  />
                )}
                <dl className="wallet-review-meta">
                  <div>
                    <dt>{t.expires}</dt>
                    <dd>
                      {review.expiresAt
                        ? new Date(review.expiresAt).toLocaleString(
                            locale === "ru" ? "ru-RU" : "en-GB",
                            { dateStyle: "medium", timeStyle: "short" },
                          )
                        : "—"}
                    </dd>
                  </div>
                </dl>
                <details className="wallet-technical">
                  <summary>
                    {t.genesis}
                    <ChevronDown size={14} />
                  </summary>
                  <WalletCopy
                    label={t.fingerprint}
                    value={review.fingerprint}
                    t={t}
                  />
                  <WalletCopy
                    label={t.baseGenesis}
                    value={network?.genesisHash}
                    t={t}
                  />
                  <WalletCopy
                    label={t.devnetGenesis}
                    value={network?.devnetGenesisHash}
                    t={t}
                  />
                </details>
                {review.txid && (
                  <div className="wallet-receipt">
                    <WalletCopy label={t.txid} value={review.txid} t={t} />
                    <div className="wallet-receipt-facts">
                      <span>
                        {t.confirmations}
                        <strong>
                          {review.confirmationState === "unknown"
                            ? t.unknownLabel
                            : (review.confirmations ?? "—")}
                        </strong>
                      </span>
                      <span>
                        {t.mempool}
                        <strong>
                          {typeof review.inMempool === "boolean"
                            ? review.inMempool
                              ? t.yes
                              : t.no
                            : t.unknownLabel}
                        </strong>
                      </span>
                    </div>
                    {review.kind === "refund" && (
                      <div className="wallet-sync">
                        <strong>
                          {t.receipt}:{" "}
                          {review.receiptSync === "synced"
                            ? t.receiptSynced
                            : t.receiptPending}
                        </strong>
                        <p>{t.refundReceipt}</p>
                        {review.receiptError && (
                          <p className="error">{review.receiptError}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {!connected && <p className="error">{t.notCurrent}</p>}
                {expired && ready && <p className="error">{t.expired}</p>}
                {[
                  "preparing",
                  "preparation_uncertain",
                  "awaiting_approval",
                  "signing",
                ].includes(review.state) && (
                  <div className="error" role="status">
                    {t.manualState}
                  </div>
                )}
                {ready && (
                  <div className="wallet-approval">
                    <p>{t.approveHelp}</p>
                    <div>
                      <button
                        className="button secondary"
                        onClick={() => action("cancel")}
                        disabled={!!busy}
                      >
                        {busy === "cancel" ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : (
                          <X size={16} />
                        )}{" "}
                        {busy === "cancel" ? t.cancelling : t.cancel}
                      </button>
                      <button
                        className="button"
                        onClick={() => action("approve")}
                        disabled={!canApprove}
                      >
                        {busy === "approve" ? (
                          <LoaderCircle size={17} className="spin" />
                        ) : (
                          <LockKeyhole size={17} />
                        )}{" "}
                        {busy === "approve" ? t.signing : t.sign}
                      </button>
                    </div>
                  </div>
                )}
                {review &&
                  ["signed", "broadcasting", "broadcast_unknown"].includes(
                    review.state,
                  ) &&
                  !confirmed && (
                    <div className="wallet-approval">
                      <p>{t.unknown}</p>
                      <button
                        className="button"
                        disabled={!!busy || !connected}
                        onClick={() => action("approve")}
                      >
                        {busy ? (
                          <LoaderCircle size={16} className="spin" />
                        ) : (
                          <RefreshCw size={16} />
                        )}{" "}
                        {t.retryTransaction}
                      </button>
                    </div>
                  )}
                {broadcast && (
                  <div className="wallet-postsend">
                    <p>
                      {review.state === "broadcast_unknown"
                        ? t.unknown
                        : confirmed
                          ? t.confirmed
                          : review.confirmationState === "pending"
                            ? t.pendingHelp
                            : t.waiting}
                    </p>
                    <a className="button secondary" href={backUrl}>
                      {t.back}
                      <ArrowRight size={16} />
                    </a>
                    <button className="text-button" onClick={refresh}>
                      <RefreshCw size={14} />
                      {t.reload}
                    </button>
                  </div>
                )}
                {cancelled && (
                  <div className="wallet-postsend">
                    <p>{t.cancelledBody}</p>
                    <a className="button secondary" href={backUrl}>
                      {t.back}
                      <ArrowRight size={16} />
                    </a>
                  </div>
                )}
              </div>
            )}
            {error && (
              <div className="error wallet-action-error" role="alert">
                {error}
              </div>
            )}
          </section>
          <aside className="wallet-account">
            <div className="wallet-account-icon">
              <Wallet size={23} />
            </div>
            <h2>{t[role]}</h2>
            <p>{networkName}</p>
            <div className="wallet-balance">
              <span>{t.balance}</span>
              <strong>
                {status?.balance ?? "—"} <small>{balanceCurrency}</small>
              </strong>
            </div>
            <div className="wallet-pending-balance">
              <span>{t.pendingBalance}</span>
              <strong>
                {status?.pendingBalance ?? "—"} {balanceCurrency}
              </strong>
            </div>
            <WalletCopy
              label={t.receive}
              value={status?.receiveAddress}
              t={t}
            />
            <p className="wallet-receive-help">
              {t.receiveHelp.replace("{currency}", balanceCurrency)}
            </p>
            <div className="wallet-boundary">
              <ShieldCheck size={17} />
              <p>{t.signerHelp}</p>
            </div>
            <a href="http://127.0.0.1:4173/#network" className="checkout-link">
              {t.network}
              <ExternalLink size={14} />
            </a>
          </aside>
        </div>
        <footer className="wallet-footer">
          <FlaskConical size={14} />
          {t.localBoundary}
        </footer>
      </main>
    </div>
  );
}
