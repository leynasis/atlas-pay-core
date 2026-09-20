import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Copy,
  Check,
  X,
  Search,
  LayoutDashboard,
  ReceiptText,
  Blocks,
  CircleHelp,
  Wallet,
  ShieldCheck,
  ChevronRight,
  RefreshCw,
  ExternalLink,
  ArrowDownLeft,
  RotateCcw,
  LoaderCircle,
  Globe2,
  Command,
  CircleDot,
  FlaskConical,
} from "lucide-react";
import "./styles.css";
import NetworkLab from "./NetworkLab.jsx";
import WalletApp from "./WalletApp.jsx";
import Logo from "./Brand.jsx";

const words = {
  en: {
    workspace: "Merchant workspace",
    overview: "Overview",
    networkNav: "Network",
    labNav: "Local network lab",
    labBanner: "Independent devnet · Local test coins only",
    invoices: "Invoices",
    support: "How it works",
    local: "LOCAL WORKSPACE",
    test: "Regtest environment",
    testNote: "Isolated Dash network · Test coins only",
    connected: "Node connected",
    disconnected: "Node offline",
    checking: "Connecting to node",
    greeting: "YOUR PAYMENTS, IN FOCUS",
    title: "Good business starts\nwith simple payments.",
    subtitle:
      "Create an invoice. Share a link. Follow every payment on your local blockchain.",
    create: "Create invoice",
    receipts: "Confirmed receipts",
    gross: "Gross incoming payments · DASH",
    outstanding: "Awaiting payment",
    openInvoices: "open invoices",
    height: "Block height",
    currentBlock: "Current local chain",
    recent: "Your invoices",
    invoiceSub: "A live view of your payment activity.",
    all: "All invoices",
    open: "Open",
    settled: "Settled",
    search: "Search invoices…",
    invoice: "Invoice",
    amount: "Amount",
    date: "Created",
    status: "Status",
    noInvoices: "Your first payment starts here.",
    noInvoicesBody:
      "Create an invoice to get a unique payment address and a checkout link.",
    noResults: "No matching invoices",
    noResultsBody: "Try another search or change your filter.",
    refresh: "Refresh",
    flow: "A simple path to paid",
    step1: "Create",
    step1Body: "Set an amount and describe your order.",
    step2: "Share",
    step2Body: "Send the checkout link or scan the QR.",
    step3: "Confirm",
    step3Body: "Mine a test block to confirm settlement.",
    network: "Local network",
    networkSub: "Connected directly to your Dash regtest node.",
    merchantBalance: "Merchant wallet",
    payerBalance: "Test payer wallet",
    mine: "Confirm a test block",
    mineHint:
      "Creates one regtest block. Pending payments and refunds can then confirm.",
    noLive: "No live funds. No mainnet transactions.",
    powered: "Built on Dash · Local prototype",
    newInvoice: "New invoice",
    newInvoiceSub: "Give your customer a clear way to pay.",
    merchant: "Merchant name",
    description: "Description",
    descriptionPlaceholder: "e.g. Design consultation",
    amountLabel: "Amount in DASH",
    expiry: "Expires in",
    hour: "1 hour",
    day: "24 hours",
    week: "7 days",
    cancel: "Cancel",
    creating: "Creating…",
    required: "Enter an amount greater than zero, with up to 8 decimal places.",
    createError: "Could not create invoice.",
    copy: "Copy",
    copied: "Copied",
    close: "Close",
    checkout: "Open checkout",
    checkoutTitle: "A clear way to pay.",
    checkoutSub: "Secure the details. Complete the payment. See it confirmed.",
    requested: "Payment requested",
    received: "Received",
    confirmed: "Confirmed",
    address: "Payment address",
    share: "Checkout link",
    tx: "Payment transaction",
    refundTx: "Refund transaction",
    pay: "Pay with test wallet",
    paying: "Sending test payment…",
    refund: "Refund payment",
    refunding: "Sending refund…",
    refundHint:
      "Returns the received payment to the local test payer in a separate transaction.",
    confirm: "Confirm payment · mine 1 block",
    confirming: "Creating test block…",
    confirmRefund: "Confirm refund · mine 1 block",
    testTools: "Local test controls",
    testToolsSub: "These controls use the test wallets on this computer.",
    refundSection: "Refund",
    expires: "Expires",
    created: "Created",
    back: "Back to workspace",
    loading: "Loading payment data…",
    retry: "Try again",
    networkError: "Cannot reach the payment server.",
    actionError: "The operation could not be completed.",
    refreshError: "Unable to refresh chain data.",
    pending: "Awaiting payment",
    partial: "Partially paid",
    detected: "Payment detected",
    paid: "Confirmed",
    expired: "Expired",
    refund_pending: "Refund pending",
    refunded: "Refunded",
    waitNote:
      "Send the exact amount to the address below. This invoice accepts regtest DASH only.",
    detectedNote:
      "Payment detected on the local chain. Mine a block to confirm it.",
    paidNote: "Payment confirmed by at least one block.",
    expiredNote:
      "This invoice has expired. Any late incoming payment will still be shown.",
    refundPendingNote: "Refund sent. Mine a block to confirm the return.",
    refundedNote: "The refund transaction is confirmed.",
    partialNote:
      "A partial payment was received. The test wallet can send the remaining amount.",
    unavailable: "Unavailable",
    invoiceDetail: "Invoice details",
    howTitle: "From request to receipt.",
    howSub: "A real local blockchain, a straightforward payment flow.",
    howNote:
      "Confirmation here means at least one mined block. InstantSend and ChainLocks are not enabled in this local environment.",
    view: "View invoice",
    merchantAccount: "Merchant account",
    balanceNote: "Balances belong to the local regtest wallets.",
    menu: "Navigation",
    networkDetail: "Network details",
    successMine: "A test block was created.",
    successPay: "Test payment sent. Confirm it with a block.",
    successRefund: "Refund sent. Confirm it with a block.",
    clipboardError: "Copy failed. Select and copy the text manually.",
    remaining: "Remaining",
    testLabel: "TEST COINS",
    blockchain: "DASH REGTEST",
    amountHelp: "Test DASH only. Up to 8 decimal places.",
    total: "Total requested",
    refreshTime: "Auto-refreshes every 5 seconds",
    qr: "QR code for the regtest Dash payment",
    connectionNeeded: "Connect the local Dash node to use test actions.",
  },
  ru: {
    workspace: "Кабинет продавца",
    overview: "Обзор",
    networkNav: "Сеть",
    labNav: "Локальная лаборатория сети",
    labBanner: "Отдельная devnet · Только локальные тестовые монеты",
    invoices: "Счета",
    support: "Как это работает",
    local: "ЛОКАЛЬНЫЙ КАБИНЕТ",
    test: "Среда Regtest",
    testNote: "Изолированная сеть Dash · Только тестовые монеты",
    connected: "Узел подключён",
    disconnected: "Узел недоступен",
    checking: "Подключение к узлу",
    greeting: "ВАШИ ПЛАТЕЖИ — НА ВИДУ",
    title: "Хороший бизнес начинается\nс простых платежей.",
    subtitle:
      "Создайте счёт. Отправьте ссылку. Отслеживайте каждый платёж в локальном блокчейне.",
    create: "Создать счёт",
    receipts: "Подтверждённые поступления",
    gross: "Все входящие платежи · DASH",
    outstanding: "Ожидают оплаты",
    openInvoices: "открытых счетов",
    height: "Высота блока",
    currentBlock: "Локальная цепочка",
    recent: "Ваши счета",
    invoiceSub: "Актуальное состояние всех платежей.",
    all: "Все счета",
    open: "Открытые",
    settled: "Завершённые",
    search: "Поиск счетов…",
    invoice: "Счёт",
    amount: "Сумма",
    date: "Создан",
    status: "Статус",
    noInvoices: "Первый платёж начинается здесь.",
    noInvoicesBody:
      "Создайте счёт, чтобы получить уникальный адрес и ссылку для оплаты.",
    noResults: "Счета не найдены",
    noResultsBody: "Измените поисковый запрос или фильтр.",
    refresh: "Обновить",
    flow: "Простой путь к оплате",
    step1: "Создайте",
    step1Body: "Укажите сумму и описание заказа.",
    step2: "Отправьте",
    step2Body: "Поделитесь ссылкой или QR-кодом.",
    step3: "Подтвердите",
    step3Body: "Создайте тестовый блок для подтверждения.",
    network: "Локальная сеть",
    networkSub: "Прямое подключение к вашему узлу Dash regtest.",
    merchantBalance: "Кошелёк продавца",
    payerBalance: "Тестовый плательщик",
    mine: "Подтвердить тестовым блоком",
    mineHint:
      "Создаёт один блок regtest для подтверждения ожидающих платежей и возвратов.",
    noLive: "Только тестовые монеты и локальная сеть.",
    powered: "На базе Dash · Локальный прототип",
    newInvoice: "Новый счёт",
    newInvoiceSub: "Удобный способ оплаты для вашего клиента.",
    merchant: "Название продавца",
    description: "Описание",
    descriptionPlaceholder: "Например, консультация по дизайну",
    amountLabel: "Сумма в DASH",
    expiry: "Срок действия",
    hour: "1 час",
    day: "24 часа",
    week: "7 дней",
    cancel: "Отмена",
    creating: "Создание…",
    required: "Введите сумму больше нуля, до 8 знаков после запятой.",
    createError: "Не удалось создать счёт.",
    copy: "Копировать",
    copied: "Скопировано",
    close: "Закрыть",
    checkout: "Открыть страницу оплаты",
    checkoutTitle: "Простой способ оплатить.",
    checkoutSub: "Проверьте данные. Отправьте платёж. Дождитесь подтверждения.",
    requested: "К оплате",
    received: "Получено",
    confirmed: "Подтверждено",
    address: "Адрес для оплаты",
    share: "Ссылка на оплату",
    tx: "Транзакция платежа",
    refundTx: "Транзакция возврата",
    pay: "Оплатить тестовым кошельком",
    paying: "Отправка тестового платежа…",
    refund: "Вернуть платёж",
    refunding: "Отправка возврата…",
    refundHint:
      "Возвращает полученный платёж локальному тестовому плательщику отдельной транзакцией.",
    confirm: "Подтвердить платёж · создать блок",
    confirming: "Создание тестового блока…",
    confirmRefund: "Подтвердить возврат · создать блок",
    testTools: "Локальные тестовые действия",
    testToolsSub: "Используются тестовые кошельки на этом компьютере.",
    refundSection: "Возврат",
    expires: "Истекает",
    created: "Создан",
    back: "Вернуться в кабинет",
    loading: "Загрузка данных платежей…",
    retry: "Повторить",
    networkError: "Нет связи с сервером платежей.",
    actionError: "Не удалось выполнить действие.",
    refreshError: "Не удалось обновить данные сети.",
    pending: "Ожидает оплаты",
    partial: "Частично оплачен",
    detected: "Платёж получен",
    paid: "Подтверждён",
    expired: "Истёк",
    refund_pending: "Ожидается возврат",
    refunded: "Возвращён",
    waitNote:
      "Отправьте точную сумму на адрес ниже. Принимаются только тестовые DASH в сети regtest.",
    detectedNote:
      "Платёж получен в локальной сети. Создайте блок для подтверждения.",
    paidNote: "Платёж подтверждён как минимум одним блоком.",
    expiredNote:
      "Срок действия счёта истёк. Поздний платёж всё равно будет показан.",
    refundPendingNote: "Возврат отправлен. Создайте блок для подтверждения.",
    refundedNote: "Транзакция возврата подтверждена.",
    partialNote:
      "Получена часть суммы. Тестовый кошелёк может отправить остаток.",
    unavailable: "Недоступно",
    invoiceDetail: "Детали счёта",
    howTitle: "От счёта до поступления.",
    howSub: "Настоящий локальный блокчейн и понятный процесс оплаты.",
    howNote:
      "Подтверждение здесь означает как минимум один созданный блок. InstantSend и ChainLocks в этой локальной среде не включены.",
    view: "Открыть счёт",
    merchantAccount: "Аккаунт продавца",
    balanceNote: "Балансы локальных кошельков regtest.",
    menu: "Навигация",
    networkDetail: "Информация о сети",
    successMine: "Тестовый блок создан.",
    successPay: "Платёж отправлен. Подтвердите его блоком.",
    successRefund: "Возврат отправлен. Подтвердите его блоком.",
    clipboardError:
      "Не удалось скопировать. Выделите и скопируйте текст вручную.",
    remaining: "Остаток",
    testLabel: "ТЕСТОВЫЕ МОНЕТЫ",
    blockchain: "DASH REGTEST",
    amountHelp: "Только тестовые DASH. До 8 знаков после запятой.",
    total: "Сумма счёта",
    refreshTime: "Обновление каждые 5 секунд",
    qr: "QR-код платежа Dash в сети regtest",
    connectionNeeded: "Для тестовых действий подключите локальный узел Dash.",
  },
};
Object.assign(words.en, {
  review: "Review needed",
  reviewBody:
    "This invoice needs manual review before another payment or refund.",
  overpaidNote: "This invoice received more than the requested amount.",
  refundedAmount: "Refund amount",
  additionalReceipt: "Received after refund",
});
Object.assign(words.ru, {
  review: "Нужна проверка",
  reviewBody:
    "Перед новым платежом или возвратом этот счёт необходимо проверить вручную.",
  overpaidNote: "На этот счёт поступило больше запрошенной суммы.",
  refundedAmount: "Сумма возврата",
  additionalReceipt: "Получено после возврата",
});
Object.assign(words.en, {
  currencyHeading: "LAVE — the currency of LAVEPAY",
  currencyNote:
    "LAVE is the chosen name of our currency. This prototype currently uses local Dash test coins, so amounts remain denominated in DASH. LAVE has not been issued yet.",
  test: "LAVEPAY local devnet",
  testNote: "Independent local chain · Test coins only",
  blockchain: "LAVEPAY DEVNET",
  networkSub: "Connected to the LAVEPAY merchant node.",
  mine: "Create a test block",
  mineHint:
    "Creates one block on the local LAVEPAY devnet to confirm pending transactions.",
  confirm: "Create a test block",
  confirmRefund: "Create a test block",
  testTools: "Your payment",
  testToolsSub:
    "Open the separate customer wallet to review and approve this payment.",
  pay: "Open customer wallet",
  refund: "Prepare refund request",
  refundHint:
    "Enter the recipient’s devnet address. The merchant wallet will separately review, sign and send the refund.",
  refunding: "Preparing request…",
  refundAddress: "Refund recipient address",
  openMerchantWallet: "Open merchant wallet",
  awaitingRefundApproval: "Refund awaits wallet approval",
  requestedRefund: "Requested refund",
  refundPrepared: "Refund request prepared.",
  customerAddressHint: "Find the receiving address in the customer wallet.",
  openCustomerWallet: "View customer wallet",
  partialNote:
    "A partial payment was received. Check the receipt before proceeding; confirmed funds can be refunded.",
  waitNote:
    "This invoice accepts local LAVEPAY devnet DASH only. The customer wallet shows the network, recipient, amount and fee before signing.",
  reviewBody:
    "This receipt needs review. Only actions explicitly available below can proceed.",
  step2Body: "Open the customer wallet and approve the transaction.",
  step3Body: "Create a test block to confirm settlement.",
  qr: "QR code for the LAVEPAY invoice checkout",
  balanceNote: "Local merchant wallet balance.",
  refundCreated: "Refund request created; no funds have been sent.",
  signingBoundary: "The merchant server does not sign customer payments.",
  unsupportedWallet: "Wallet approval is unavailable for this invoice.",
  legacy: "Legacy regtest",
});
Object.assign(words.ru, {
  currencyHeading: "LAVE — валюта системы LAVEPAY",
  currencyNote:
    "LAVE — выбранное название нашей валюты. Сейчас прототип использует локальные тестовые монеты Dash, поэтому суммы обозначены DASH. Выпуск LAVE ещё впереди.",
  test: "Локальная devnet LAVEPAY",
  testNote: "Отдельная локальная цепочка · Тестовые монеты",
  blockchain: "LAVEPAY DEVNET",
  networkSub: "Подключение к узлу продавца LAVEPAY.",
  mine: "Создать тестовый блок",
  mineHint:
    "Создаёт один блок в локальной devnet LAVEPAY для подтверждения ожидающих транзакций.",
  confirm: "Создать тестовый блок",
  confirmRefund: "Создать тестовый блок",
  testTools: "Ваш платёж",
  testToolsSub:
    "Откройте отдельный кошелёк покупателя, чтобы проверить и подтвердить платёж.",
  pay: "Открыть кошелёк покупателя",
  refund: "Подготовить запрос возврата",
  refundHint:
    "Введите адрес получателя в devnet. Кошелёк продавца отдельно проверит, подпишет и отправит возврат.",
  refunding: "Подготовка запроса…",
  refundAddress: "Адрес получателя возврата",
  openMerchantWallet: "Открыть кошелёк продавца",
  awaitingRefundApproval: "Возврат ожидает одобрения в кошельке",
  requestedRefund: "Запрошенный возврат",
  refundPrepared: "Запрос возврата подготовлен.",
  customerAddressHint: "Адрес для получения указан в кошельке покупателя.",
  openCustomerWallet: "Открыть кошелёк покупателя",
  partialNote:
    "Получена часть суммы. Проверьте поступление; подтверждённые средства можно вернуть.",
  waitNote:
    "Принимаются только тестовые DASH локальной devnet LAVEPAY. Кошелёк покупателя покажет сеть, получателя, сумму и комиссию до подписания.",
  reviewBody:
    "Это поступление требует проверки. Доступны только явно разрешённые действия ниже.",
  step2Body: "Откройте кошелёк покупателя и одобрите транзакцию.",
  step3Body: "Создайте тестовый блок для подтверждения.",
  qr: "QR-код страницы оплаты LAVEPAY",
  balanceNote: "Баланс локального кошелька продавца.",
  refundCreated: "Запрос возврата создан; средства ещё не отправлены.",
  signingBoundary: "Сервер продавца не подписывает платежи покупателя.",
  unsupportedWallet: "Для этого счёта одобрение в кошельке недоступно.",
  legacy: "Прежняя regtest",
});
const sats = (value) => {
  const [whole, decimal = ""] = String(value || "0").split(".");
  return (
    BigInt(whole || "0") * 100000000n +
    BigInt(decimal.padEnd(8, "0").slice(0, 8))
  );
};
const coin = (value) => {
  const n = typeof value === "bigint" ? value : sats(value);
  const fraction = String(n % 100000000n)
    .padStart(8, "0")
    .replace(/0+$/, "");
  return `${n / 100000000n}${fraction ? "." + fraction : ""}`;
};
const key = () => crypto.randomUUID();
async function api(path, method = "GET", body) {
  const response = await fetch("/api" + path, {
    method,
    headers:
      method === "GET"
        ? undefined
        : { "Content-Type": "application/json", "Idempotency-Key": key() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error?.message || `HTTP ${response.status}`);
  return result;
}
function Badge({ status, t, review = false }) {
  return (
    <span className={"badge " + (review ? "review" : status)}>
      <span />
      {review ? t.review : t[status] || status}
    </span>
  );
}
function Spinner() {
  return <LoaderCircle className="spin" size={18} />;
}
function Button({ children, busy, kind = "", ...props }) {
  return (
    <button
      className={"button " + kind}
      {...props}
      disabled={props.disabled || busy}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}
function CopyField({ label, value, t, onToast }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      onToast(t.clipboardError, true);
    }
  }
  return (
    <div className="copy-group">
      <span className="field-caption">{label}</span>
      <div className="copy-field">
        <code>{value}</code>
        <button
          aria-label={copied ? t.copied : t.copy}
          title={copied ? t.copied : t.copy}
          onClick={copy}
        >
          {copied ? <Check size={17} /> : <Copy size={17} />}
        </button>
      </div>
    </div>
  );
}
function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const old = document.activeElement;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const node = ref.current;
    node.querySelector("input,button")?.focus();
    function down(e) {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const list = [
          ...node.querySelectorAll(
            'button:not(:disabled),a[href],input,select,[tabindex="0"]',
          ),
        ];
        if (!list.length) return;
        const first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", down);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", down);
      old?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={"modal " + (wide ? "wide" : "")}
      >
        {children}
      </section>
    </div>
  );
}
function InvoiceForm({ t, onClose, onCreated }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const amount = String(form.get("amount")).trim().replace(",", ".");
    if (!/^\d+(\.\d{1,8})?$/.test(amount) || sats(amount) <= 0n) {
      setError(t.required);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await api("/invoices", "POST", {
        amount,
        description: String(form.get("description")).trim(),
        merchantName: String(form.get("merchantName")).trim(),
        expiresInMinutes: Number(form.get("expiry")),
      });
      onCreated(data.invoice);
    } catch (err) {
      setError(err.message || t.createError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t.newInvoice}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="modal-heading">
        <span className="modal-icon">
          <ReceiptText size={23} />
        </span>
        <button
          className="icon-button"
          onClick={onClose}
          disabled={busy}
          aria-label={t.close}
        >
          <X />
        </button>
      </div>
      <h2>{t.newInvoice}</h2>
      <p className="muted">{t.newInvoiceSub}</p>
      <form onSubmit={submit}>
        <label>
          {t.merchant}
          <input
            name="merchantName"
            defaultValue="LAVEPAY Studio"
            required
            maxLength={100}
            autoComplete="organization"
          />
        </label>
        <label>
          {t.description}
          <input
            name="description"
            placeholder={t.descriptionPlaceholder}
            required
            maxLength={300}
          />
        </label>
        <label>
          {t.amountLabel}
          <div className="amount-input">
            <input
              name="amount"
              placeholder="0.00"
              inputMode="decimal"
              required
              autoComplete="off"
            />
            <span>DASH</span>
          </div>
          <small>{t.amountHelp}</small>
        </label>
        <label>
          {t.expiry}
          <select name="expiry" defaultValue="60">
            <option value="60">{t.hour}</option>
            <option value="1440">{t.day}</option>
            <option value="10080">{t.week}</option>
          </select>
        </label>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <Button
            type="button"
            kind="secondary"
            onClick={onClose}
            disabled={busy}
          >
            {t.cancel}
          </Button>
          <Button type="submit" busy={busy}>
            {busy ? t.creating : t.create}
            <ArrowRight size={17} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function Detail({
  invoice: i,
  t,
  locale,
  onToast,
  refresh,
  status,
  checkout = false,
}) {
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [refundAddress, setRefundAddress] = useState("");
  const requestKey = useRef(key());
  const connected = status?.connected;
  const walletUrl = (role, kind) =>
    `http://127.0.0.1:${role === "customer" ? "4174" : "4175"}/#invoice=${encodeURIComponent(i.id)}&kind=${kind}`;
  const note = {
    pending: "waitNote",
    partial: "partialNote",
    detected: "detectedNote",
    paid: "paidNote",
    expired: "expiredNote",
    refund_pending: "refundPendingNote",
    refunded: "refundedNote",
  }[i.status];
  async function mine() {
    if (busy) return;
    setBusy("mine");
    setError("");
    try {
      await api("/dev/mine", "POST", { blocks: 1, invoiceId: i.id });
      await refresh();
      onToast(t.successMine);
    } catch (err) {
      setError(err.message || t.actionError);
    } finally {
      setBusy("");
    }
  }
  async function requestRefund(event) {
    event.preventDefault();
    if (busy) return;
    setBusy("refund");
    setError("");
    try {
      const response = await fetch(
        `/api/invoices/${encodeURIComponent(i.id)}/refund-request`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": requestKey.current,
          },
          body: JSON.stringify({ address: refundAddress.trim() }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message || `HTTP ${response.status}`);
      await refresh();
      onToast(t.refundCreated);
      location.assign(walletUrl("merchant", "refund"));
    } catch (err) {
      setError(err.message || t.actionError);
    } finally {
      setBusy("");
    }
  }
  const canPay =
    i.paymentRequestAvailable === true && Date.parse(i.expiresAt) > Date.now();
  return (
    <>
      <div className="detail-top">
        <div>
          <div className="eyebrow">{i.merchantName}</div>
          <h2>{i.description}</h2>
          <span className="invoice-id">#{i.id}</span>
        </div>
        <Badge status={i.status} t={t} review={i.requiresReview} />
      </div>
      <div className="payment-body">
        <div className="payment-main">
          {i.requiresReview && (
            <div className="error" role="alert">
              <strong>{t.review}</strong>
              <p>{t.reviewBody}</p>
              {i.reviewReason && <small>{i.reviewReason}</small>}
            </div>
          )}
          {i.overpaid && (
            <div className="status-note">
              <p>{t.overpaidNote}</p>
            </div>
          )}
          <div className="amount-label">{t.requested}</div>
          <div className="payment-amount">
            {coin(i.amount)} <span>DASH</span>
          </div>
          <div className="test-chip">
            <FlaskConical size={12} />
            {t.testLabel}
          </div>
          <div className={"status-note note-" + i.status}>
            {["paid", "refunded"].includes(i.status) ? (
              <ShieldCheck size={19} />
            ) : (
              <CircleDot size={19} />
            )}
            <p>{t[note]}</p>
          </div>
          <div className="qr-wrap">
            <img
              src={`/api/invoices/${encodeURIComponent(i.id)}/qr`}
              alt={t.qr}
              width="184"
              height="184"
            />
            <div className="qr-caption">
              DASH{" "}
              <span>
                {status?.network === "regtest" ? "REGTEST" : "LAVEPAY DEVNET"}
              </span>
            </div>
          </div>
          <CopyField
            label={t.address}
            value={i.address}
            t={t}
            onToast={onToast}
          />
          {!checkout && (
            <CopyField
              label={t.share}
              value={location.origin + "/pay/" + i.id}
              t={t}
              onToast={onToast}
            />
          )}
          <div className="detail-facts">
            <div>
              <span>{t.received}</span>
              <strong>{coin(i.receivedAmount)} DASH</strong>
            </div>
            <div>
              <span>{t.confirmed}</span>
              <strong>{coin(i.confirmedAmount)} DASH</strong>
            </div>
            {i.refundRequestId && (
              <div>
                <span>{t.requestedRefund}</span>
                <strong>{coin(i.requestedRefundAmount)} DASH</strong>
              </div>
            )}
            {i.refundTxid && (
              <div>
                <span>{t.refundedAmount}</span>
                <strong>{coin(i.refundAmount)} DASH</strong>
              </div>
            )}
            {i.additionalReceivedAfterRefund &&
              sats(i.additionalReceivedAfterRefund) > 0n && (
                <div>
                  <span>{t.additionalReceipt}</span>
                  <strong>{coin(i.additionalReceivedAfterRefund)} DASH</strong>
                </div>
              )}
            <div>
              <span>{t.expires}</span>
              <strong>
                {new Date(i.expiresAt).toLocaleString(
                  locale === "ru" ? "ru-RU" : "en-GB",
                  { dateStyle: "medium", timeStyle: "short" },
                )}
              </strong>
            </div>
          </div>
          {i.paymentTxid && (
            <CopyField
              label={t.tx}
              value={i.paymentTxid}
              t={t}
              onToast={onToast}
            />
          )}{" "}
          {i.refundAddress && (
            <CopyField
              label={t.refundAddress}
              value={i.refundAddress}
              t={t}
              onToast={onToast}
            />
          )}{" "}
          {i.refundTxid && (
            <CopyField
              label={t.refundTx}
              value={i.refundTxid}
              t={t}
              onToast={onToast}
            />
          )}
        </div>
        <aside className="payment-controls">
          <div className="control-icon">
            <Wallet size={22} />
          </div>
          <h3>{t.testTools}</h3>
          {canPay && <p>{t.testToolsSub}</p>}
          {!connected && <div className="error">{t.connectionNeeded}</div>}
          {canPay && (
            <a className="button" href={walletUrl("customer", "payment")}>
              <Wallet size={17} />
              {t.pay}
              <ExternalLink size={14} />
            </a>
          )}
          {["detected", "refund_pending"].includes(i.status) && (
            <Button
              onClick={mine}
              disabled={!connected || !!busy}
              busy={busy === "mine"}
            >
              <Blocks size={17} />
              {busy === "mine" ? t.confirming : t.mine}
            </Button>
          )}
          {["paid", "refunded"].includes(i.status) && (
            <div className="confirmed-box">
              <ShieldCheck size={27} />
              <strong>{t[i.status]}</strong>
            </div>
          )}
          {i.refundRequestStatus === "awaiting_approval" && (
            <div className="refund-area">
              <h4>{t.awaitingRefundApproval}</h4>
              <p>{t.refundCreated}</p>
              <a
                className="button secondary"
                href={walletUrl("merchant", "refund")}
              >
                {t.openMerchantWallet}
                <ExternalLink size={14} />
              </a>
            </div>
          )}
          {i.canRequestRefund && (
            <div className="refund-area">
              <h4>{t.refundSection}</h4>
              <p>{t.refundHint}</p>
              <form className="refund-form" onSubmit={requestRefund}>
                <label htmlFor="refund-address">{t.refundAddress}</label>
                <input
                  id="refund-address"
                  name="address"
                  value={refundAddress}
                  onChange={(e) => {
                    setRefundAddress(e.target.value);
                    requestKey.current = key();
                  }}
                  required
                  autoComplete="off"
                  spellCheck="false"
                />
                <small>{t.customerAddressHint}</small>
                <a
                  href="http://127.0.0.1:4174/"
                  target="_blank"
                  rel="noreferrer"
                  className="checkout-link"
                >
                  {t.openCustomerWallet}
                  <ExternalLink size={13} />
                </a>
                <Button
                  type="submit"
                  kind="secondary"
                  disabled={!connected || !!busy || !refundAddress.trim()}
                  busy={busy === "refund"}
                >
                  <RotateCcw size={15} />
                  {busy === "refund" ? t.refunding : t.refund}
                </Button>
              </form>
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <div className="control-footer">
            <ShieldCheck size={15} />
            <span>{t.signingBoundary}</span>
          </div>
          {!checkout && (
            <a
              className="checkout-link"
              href={"/pay/" + i.id}
              target="_blank"
              rel="noreferrer"
            >
              {t.checkout}
              <ExternalLink size={15} />
            </a>
          )}
        </aside>
      </div>
    </>
  );
}
function App() {
  const [locale, setLocale] = useState(
    () =>
      localStorage.getItem("atlas-language") ||
      (navigator.language.startsWith("ru") ? "ru" : "en"),
  );
  const t = words[locale] || words.en;
  const [invoices, setInvoices] = useState([]),
    [status, setStatus] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [create, setCreate] = useState(false),
    [selected, setSelected] = useState(null),
    [filter, setFilter] = useState("all"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(() =>
      ["network", "invoices", "help"].includes(location.hash.slice(1))
        ? location.hash.slice(1)
        : "overview",
    ),
    [mining, setMining] = useState(false),
    [toast, setToast] = useState(null),
    [checkoutInvoice, setCheckoutInvoice] = useState(null);
  function navigatePage(next) {
    setPage(next);
    history.replaceState(
      null,
      "",
      location.pathname +
        location.search +
        (next === "overview" ? "" : "#" + next),
    );
  }
  useEffect(() => {
    function hashChanged() {
      setPage(
        ["network", "invoices", "help"].includes(location.hash.slice(1))
          ? location.hash.slice(1)
          : "overview",
      );
    }
    window.addEventListener("hashchange", hashChanged);
    return () => window.removeEventListener("hashchange", hashChanged);
  }, []);
  const toastTimer = useRef(null);
  const checkoutId = location.pathname.match(/^\/pay\/([^/]+)\/?$/)?.[1];
  const onToast = useCallback((message, bad = false) => {
    setToast({ message, bad });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);
  const refresh = useCallback(async () => {
    try {
      const requests = [
        api("/status"),
        checkoutId
          ? api("/invoices/" + encodeURIComponent(checkoutId))
          : api("/invoices"),
      ];
      const [networkResult, dataResult] = await Promise.allSettled(requests);
      if (networkResult.status === "fulfilled") setStatus(networkResult.value);
      else setStatus((previous) => ({ ...previous, connected: false }));
      if (dataResult.status === "rejected") throw dataResult.reason;
      if (networkResult.status === "rejected") throw networkResult.reason;
      const data = dataResult.value;
      if (checkoutId) setCheckoutInvoice(data.invoice);
      else setInvoices(data.invoices);
      setError("");
    } catch (err) {
      setError(err.message || t.networkError);
    } finally {
      setLoading(false);
    }
  }, [checkoutId, t.networkError]);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);
  useEffect(() => {
    localStorage.setItem("atlas-language", locale);
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  async function mine() {
    setMining(true);
    try {
      await api("/dev/mine", "POST", { blocks: 1 });
      await refresh();
      onToast(t.successMine);
    } catch (err) {
      onToast(err.message, true);
    } finally {
      setMining(false);
    }
  }
  const selectedInvoice = invoices.find((i) => i.id === selected);
  const localeControl = (
    <div className="language-switch" aria-label="Language">
      <Globe2 size={14} />
      <button aria-pressed={locale === "en"} onClick={() => setLocale("en")}>
        EN
      </button>
      <span>/</span>
      <button aria-pressed={locale === "ru"} onClick={() => setLocale("ru")}>
        RU
      </button>
    </div>
  );
  const nodeIndicator = (
    <span
      className={"node-status " + (status?.connected ? "online" : "offline")}
    >
      <i />
      {!status && loading
        ? t.checking
        : status?.connected
          ? t.connected
          : t.disconnected}
    </span>
  );
  const testBanner = (
    <div className="test-banner">
      <FlaskConical size={14} />
      <strong>{status?.network === "regtest" ? t.legacy : t.test}</strong>
      <span>{t.testNote}</span>
    </div>
  );
  const toastElement = toast && (
    <div className={"toast " + (toast.bad ? "toast-error" : "")} role="status">
      {toast.bad ? <CircleHelp size={18} /> : <Check size={18} />}
      <span>{toast.message}</span>
      <button
        className="icon-button"
        onClick={() => setToast(null)}
        aria-label={t.close}
      >
        <X size={15} />
      </button>
    </div>
  );
  if (checkoutId)
    return (
      <div className="checkout-page">
        <header className="checkout-header">
          <Logo />
          {localeControl}
        </header>
        {testBanner}
        <main className="checkout-shell">
          <a href="/" className="back-link">
            ← {t.back}
          </a>
          <div className="checkout-intro">
            <div>
              <div className="eyebrow">LAVEPAY</div>
              <h1>{t.checkoutTitle}</h1>
            </div>
            {nodeIndicator}
          </div>
          {loading ? (
            <div className="loading-card">
              <Spinner />
              {t.loading}
            </div>
          ) : error ? (
            <div className="error" role="alert">
              {error}
              <Button kind="secondary" onClick={refresh}>
                {t.retry}
              </Button>
            </div>
          ) : (
            checkoutInvoice && (
              <div className="checkout-card">
                <Detail
                  invoice={checkoutInvoice}
                  t={t}
                  locale={locale}
                  onToast={onToast}
                  refresh={refresh}
                  status={status}
                  checkout
                />
              </div>
            )
          )}
          <p className="checkout-disclaimer">{t.howNote}</p>
        </main>
        <footer className="checkout-footer">
          {t.powered}
          <span>{t.noLive}</span>
        </footer>
        {toastElement}
      </div>
    );
  const openItems = invoices.filter((i) =>
    ["pending", "partial", "detected"].includes(i.status),
  );
  const receipts = invoices.reduce((n, i) => n + sats(i.confirmedAmount), 0n);
  const remaining = openItems.reduce((n, i) => {
    const difference = sats(i.amount) - sats(i.receivedAmount);
    return n + (difference > 0n ? difference : 0n);
  }, 0n);
  const filtered = invoices.filter(
    (i) =>
      (filter === "all" ||
        (filter === "open" &&
          ["pending", "partial", "detected"].includes(i.status)) ||
        (filter === "settled" &&
          ["paid", "refund_pending", "refunded"].includes(i.status))) &&
      [i.description, i.merchantName, i.id]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Logo />
        <div className="sidebar-label">{t.local}</div>
        <nav aria-label={t.menu}>
          <button
            className={page === "overview" ? "active" : ""}
            onClick={() => navigatePage("overview")}
          >
            <LayoutDashboard size={19} />
            {t.overview}
            <span className="nav-dot" />
          </button>
          <button
            className={page === "invoices" ? "active" : ""}
            onClick={() => navigatePage("invoices")}
          >
            <ReceiptText size={19} />
            {t.invoices}
            <span className="nav-count">{invoices.length}</span>
          </button>
          <button
            className={page === "network" ? "active" : ""}
            onClick={() => navigatePage("network")}
            title={t.networkNav}
            aria-label={t.networkNav}
          >
            <Blocks size={19} />
            {t.networkNav}
          </button>
          <button
            className={page === "help" ? "active" : ""}
            onClick={() => navigatePage("help")}
          >
            <CircleHelp size={19} />
            {t.support}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-network">
            <div className="mini-node">
              <Blocks size={19} />
            </div>
            <div>
              <strong>
                {status?.network === "regtest"
                  ? "Dash regtest"
                  : "LAVEPAY devnet"}
              </strong>
              <span>{status?.connected ? t.connected : t.disconnected}</span>
            </div>
            <i className={status?.connected ? "online-dot" : "offline-dot"} />
          </div>
          <div className="account">
            <div className="avatar">L</div>
            <div>
              <strong>LAVEPAY Studio</strong>
              <span>{t.merchantAccount}</span>
            </div>
            <ChevronRight size={15} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>{t.workspace}</span>
            <ChevronRight size={13} />
            <strong>
              {
                t[
                  page === "help"
                    ? "support"
                    : page === "network"
                      ? "networkNav"
                      : page
                ]
              }
            </strong>
          </div>
          <div className="topbar-right">
            {page === "network" ? (
              <span className="lab-topbar-label">
                <FlaskConical size={13} />
                {t.labNav}
              </span>
            ) : (
              nodeIndicator
            )}
            {localeControl}
          </div>
        </header>
        {page === "network" ? (
          <div className="test-banner">
            <FlaskConical size={14} />
            <strong>{t.labNav}</strong>
            <span>{t.labBanner}</span>
          </div>
        ) : (
          testBanner
        )}
        <main className="dashboard">
          {page === "network" ? (
            <NetworkLab locale={locale} />
          ) : page === "help" ? (
            <>
              <div className="page-heading">
                <div className="eyebrow">LAVEPAY / GUIDE</div>
                <h1>{t.howTitle}</h1>
                <p>{t.howSub}</p>
              </div>
              <section className="currency-brand-card">
                <span className="currency-brand-symbol">LAVE</span>
                <div>
                  <h2>{t.currencyHeading}</h2>
                  <p>{t.currencyNote}</p>
                </div>
              </section>
              <Flow t={t} />
              <div className="help-box">
                <ShieldCheck size={25} />
                <p>{t.howNote}</p>
              </div>
            </>
          ) : (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow">{t.greeting}</div>
                  <h1>{page === "invoices" ? t.invoices : t.title}</h1>
                  <p>{t.subtitle}</p>
                </div>
                <Button onClick={() => setCreate(true)}>
                  <Plus size={18} />
                  {t.create}
                </Button>
              </section>
              {error && (
                <div className="error main-error" role="alert">
                  <span>{error}</span>
                  <button onClick={refresh}>
                    {t.retry}
                    <RefreshCw size={15} />
                  </button>
                </div>
              )}
              {page === "overview" && (
                <div className="stats-grid">
                  <div className="stat-card featured">
                    <div className="stat-label">
                      {t.receipts}
                      <span>
                        <ArrowDownLeft size={19} />
                      </span>
                    </div>
                    <div className="stat-value">
                      {loading || (error && !invoices.length)
                        ? "—"
                        : coin(receipts)}{" "}
                      <small>DASH</small>
                    </div>
                    <div className="stat-note">
                      <span className="green-dot" />
                      {t.gross}
                    </div>
                    <div className="stat-decoration" />
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">
                      {t.outstanding}
                      <span>
                        <ReceiptText size={19} />
                      </span>
                    </div>
                    <div className="stat-value">
                      {loading || (error && !invoices.length)
                        ? "—"
                        : coin(remaining)}{" "}
                      <small>DASH</small>
                    </div>
                    <div className="stat-note">
                      {openItems.length} {t.openInvoices}
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">
                      {t.height}
                      <span>
                        <Blocks size={19} />
                      </span>
                    </div>
                    <div className="stat-value">
                      {status?.blockHeight?.toLocaleString() ?? "—"}
                      <small className="block-tag">
                        {status?.network === "regtest" ? "REGTEST" : "DEVNET"}
                      </small>
                    </div>
                    <div className="stat-note">
                      {t.currentBlock}
                      <ArrowUpRight size={14} />
                    </div>
                  </div>
                </div>
              )}
              <section className="invoice-section">
                <div className="section-heading">
                  <div>
                    <h2>
                      {t.recent}
                      <span className="count-chip">{invoices.length}</span>
                    </h2>
                    <p>{t.invoiceSub}</p>
                  </div>
                  <button
                    className="icon-button refresh-button"
                    onClick={refresh}
                    aria-label={t.refresh}
                    title={t.refresh}
                  >
                    <RefreshCw size={17} />
                  </button>
                </div>
                <div className="table-toolbar">
                  <div className="filter-tabs" aria-label={t.status}>
                    {["all", "open", "settled"].map((f) => (
                      <button
                        key={f}
                        onClick={() => setFilter(f)}
                        aria-pressed={filter === f}
                      >
                        {t[f]}
                      </button>
                    ))}
                  </div>
                  <div className="search-field">
                    <Search size={17} />
                    <input
                      aria-label={t.search}
                      placeholder={t.search}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                      <button
                        aria-label={t.close}
                        onClick={() => setSearch("")}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
                {loading ? (
                  <div className="empty-state">
                    <Spinner />
                    <p>{t.loading}</p>
                  </div>
                ) : !filtered.length ? (
                  <div className="empty-state">
                    <div className="empty-art">
                      <ReceiptText size={28} />
                      <span>
                        <Plus size={11} />
                      </span>
                    </div>
                    <h3>{invoices.length ? t.noResults : t.noInvoices}</h3>
                    <p>
                      {invoices.length ? t.noResultsBody : t.noInvoicesBody}
                    </p>
                    {!invoices.length && (
                      <button
                        className="text-button"
                        onClick={() => setCreate(true)}
                      >
                        {t.create}
                        <ArrowRight size={16} />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>{t.invoice}</th>
                          <th>{t.amount}</th>
                          <th>{t.status}</th>
                          <th>{t.date}</th>
                          <th>
                            <span className="sr-only">{t.view}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((i) => (
                          <tr key={i.id}>
                            <td>
                              <button
                                className="invoice-cell"
                                onClick={() => setSelected(i.id)}
                              >
                                <span className="invoice-icon">
                                  <ReceiptText size={19} />
                                </span>
                                <span>
                                  <strong>{i.description}</strong>
                                  <small>
                                    {i.merchantName} <span>·</span> #
                                    {i.id.slice(0, 8)}
                                  </small>
                                </span>
                              </button>
                            </td>
                            <td className="table-amount">
                              {coin(i.amount)} <span>DASH</span>
                            </td>
                            <td>
                              <Badge
                                status={i.status}
                                t={t}
                                review={i.requiresReview}
                              />
                            </td>
                            <td className="table-date">
                              {new Date(i.createdAt).toLocaleDateString(
                                locale === "ru" ? "ru-RU" : "en-GB",
                                {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                },
                              )}
                            </td>
                            <td>
                              <button
                                className="icon-button"
                                aria-label={t.view + ": " + i.description}
                                onClick={() => setSelected(i.id)}
                              >
                                <ArrowUpRight size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="table-footer">
                  <span>
                    <CircleDot size={12} />
                    {t.refreshTime}
                  </span>
                  <span>{t.blockchain}</span>
                </div>
              </section>
              {page === "overview" && (
                <div className="bottom-grid">
                  <Flow t={t} />
                  <section className="network-card">
                    <div className="network-heading">
                      <div className="network-icon">
                        <Blocks size={19} />
                      </div>
                      <div>
                        <h3>{t.network}</h3>
                        <span>
                          {status?.network === "regtest"
                            ? "Dash Core · Regtest"
                            : "LAVEPAY · atlas-local-v1"}
                        </span>
                      </div>
                      <span
                        className={
                          "connection-dot " +
                          (status?.connected ? "online" : "")
                        }
                      />
                    </div>
                    <div className="balance-row">
                      <span>{t.merchantBalance}</span>
                      <strong>
                        {status?.balances?.merchant ?? "—"} <small>DASH</small>
                      </strong>
                    </div>
                    <a className="checkout-link" href="http://127.0.0.1:4174/">
                      {t.openCustomerWallet}
                      <ExternalLink size={14} />
                    </a>
                    <Button
                      kind="secondary"
                      onClick={mine}
                      busy={mining}
                      disabled={!status?.connected}
                    >
                      <Blocks size={15} />
                      {mining ? t.confirming : t.mine}
                    </Button>
                    <p>{t.mineHint}</p>
                  </section>
                </div>
              )}
            </>
          )}
          <footer className="dashboard-footer">
            <span>{t.powered}</span>
            <span>
              <ShieldCheck size={13} />
              {t.noLive}
            </span>
          </footer>
        </main>
      </div>
      {create && (
        <InvoiceForm
          t={t}
          onClose={() => setCreate(false)}
          onCreated={(i) => {
            setCreate(false);
            setInvoices((list) => [i, ...list.filter((x) => x.id !== i.id)]);
            setSelected(i.id);
            refresh();
          }}
        />
      )}
      {selectedInvoice && (
        <Modal title={t.invoiceDetail} wide onClose={() => setSelected(null)}>
          <div className="detail-modal-header">
            <span>{t.invoiceDetail}</span>
            <button
              className="icon-button"
              aria-label={t.close}
              onClick={() => setSelected(null)}
            >
              <X size={21} />
            </button>
          </div>
          <Detail
            invoice={selectedInvoice}
            t={t}
            locale={locale}
            onToast={onToast}
            refresh={refresh}
            status={status}
          />
        </Modal>
      )}
      {toastElement}
    </div>
  );
}
function Flow({ t }) {
  return (
    <section className="flow-card">
      <div className="flow-heading">
        <span className="eyebrow">LAVEPAY</span>
        <h3>{t.flow}</h3>
        <div className="flow-decoration">
          <ArrowUpRight size={25} />
        </div>
      </div>
      <div className="flow-steps">
        {[
          [ReceiptText, "step1", "step1Body"],
          [ArrowUpRight, "step2", "step2Body"],
          [Check, "step3", "step3Body"],
        ].map(([Icon, title, body], index) => (
          <div className="flow-step" key={title}>
            <div className="step-icon">
              <Icon size={18} />
              <span>0{index + 1}</span>
            </div>
            <h4>{t[title]}</h4>
            <p>{t[body]}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
createRoot(document.getElementById("root")).render(
  ["4174", "4175"].includes(location.port) ? <WalletApp /> : <App />,
);
