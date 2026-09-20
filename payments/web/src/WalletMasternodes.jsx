import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Coins,
  Copy,
  Cpu,
  Fingerprint,
  Globe2,
  Info,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import "./WalletMasternodes.css";

const words = {
  ru: {
    eyebrow: "LAVE / ВАША ЧАСТЬ СЕТИ",
    title: "Ваш узел.\nСила сети.",
    intro:
      "Запускайте мастерноды из кошелька. Управляйте обеспечением, следите за узлами и полученными наградами в одном месте.",
    launch: "Создать мастерноду",
    collateral: "Обеспечение одной мастерноды",
    collateralShort: "Обеспечение",
    local: "На этом компьютере",
    localNote:
      "Локальная тестовая сеть LAVE. Управление доступно доверенному оператору этого компьютера.",
    available: "Доступно для запуска",
    locked: "Заблокировано",
    rewards: "Полученные награды",
    rewardsNote: "Созревшие выплаты текущей мастерноды",
    immatureRewards: "Ещё созревает",
    unknownRewards: "Данные о выплатах ещё не получены",
    active: "Активные мастерноды",
    totalNodes: "Всего в этом кошельке",
    nodes: "Мои мастерноды",
    nodesNote: "Обеспечение остаётся под управлением вашего кошелька.",
    refresh: "Обновить",
    refreshed: "Проверено",
    loading: "Проверяем кошелёк и мастерноды…",
    error: "Не удалось получить состояние мастернод.",
    stale: "Свежие данные недоступны. Действия временно отключены.",
    recovery:
      "Кошелёк восстановлен из копии. Подписание заблокировано до сверки истории.",
    unsupported: "Запуск мастернод доступен в локальной сети LAVE.",
    empty: "Ваша первая мастернода",
    emptyBody:
      "Отдельный узел для работы сети. Начните с проверки доступных монет — перед запуском кошелёк покажет точную комиссию и запросит ваше одобрение.",
    need: "Для запуска требуется",
    plusFee: "+ комиссия сети",
    insufficient: "Недостаточно доступных монет для обеспечения и комиссии.",
    privateFee:
      "Для комиссии регистрации нужна подтверждённая сдача в кошельке. Обеспечение остаётся заблокированным; поступления на адреса счетов для этой комиссии не используются.",
    unavailable: "Запуск сейчас недоступен. Обновите состояние кошелька.",
    fund: "Откройте кошелёк, чтобы скопировать адрес для пополнения.",
    onlineRule: "Компьютер должен оставаться включённым и подключённым к сети.",
    lockRule: "Обеспечение исключается из обычных платежей кошелька.",
    payoutRule:
      "Награды зависят от блоков и правил сети; фиксированная доходность не обещается.",
    prepare: "Подготовить запуск",
    name: "Название мастерноды",
    namePlaceholder: "Моя мастернода",
    localMachine: "Локальный узел",
    localMachineNote:
      "Сервис создаст отдельный процесс узла на этом компьютере.",
    configuration: "Настройка",
    collateral_pending: "Подтверждается обеспечение",
    collateral_ready: "Готова к регистрации",
    registration_pending: "Подтверждается регистрация",
    draft: "Обеспечение не отправлено",
    register: "Зарегистрировать",
    registrationKind: "Регистрация мастерноды",
    collateralKind: "Резервирование обеспечения",
    retireKind: "Возврат обеспечения",
    registrationHelp:
      "Обеспечение подтверждено и остаётся заблокированным. Для регистрации потребуется вторая подпись и отдельная комиссия.",
    collateralHelp:
      "Сначала подтвердите обеспечение в блоке, затем одобрите отдельную регистрацию мастерноды.",
    waitingBlock:
      "Ожидаем подтверждения в блоке. Монеты уже зарезервированы; повторная подпись не требуется.",
    registrationDebit: "Дополнительное списание",
    alreadyLocked: "Уже заблокировано",
    cancel: "Отменить подготовку",
    retry: "Повторить ту же отправку",
    configured: "Мастернода создана",
    finalityPending:
      "Вывод подтверждён блоком. Новую мастерноду можно будет создать после проверки ChainLock этого вывода.",
    previousRunning:
      "Остановите прежний узел перед созданием новой мастерноды. Вывод монет и остановка узла — отдельные действия.",
    coreState: "Состояние узла LAVE Core",
    WAITING_FOR_PROTX: "Ожидает регистрации",
    POSE_BANNED: "Заблокирована сетью",
    REMOVED: "Исключена из сети",
    OPERATOR_KEY_CHANGED: "Ключ оператора изменён",
    PROTX_IP_CHANGED: "Адрес узла изменён",
    ERROR: "Ошибка узла",
    UNKNOWN: "Проверяется",
    retire_pending: "Подтверждается вывод",
    review: "Проверка",
    confirm: "Одобрение",
    newTitle: "Новая мастернода",
    newNote: "Настройте узел. Следующий шаг — проверка реальной транзакции.",
    fee: "Комиссия транзакции",
    calculated: "Будет рассчитана перед одобрением",
    total: "Всего потребуется",
    signing: "Обрабатываем действие…",
    approve: "Одобрить и продолжить",
    reviewTitle: "Проверьте перед подписью",
    reviewNote:
      "Одобрение разрешает кошельку подписать и отправить только показанную операцию.",
    fingerprint: "Отпечаток операции",
    network: "Сеть",
    destination: "Адрес обеспечения",
    payout: "Адрес выплат",
    service: "Адрес узла",
    expires: "Срок одобрения",
    expired: "Срок одобрения истёк. Обновите состояние.",
    preparing: "Подготовка",
    prepared: "Ожидает одобрения",
    funding: "Обеспечение отправлено",
    awaiting_funding: "Ожидает обеспечения",
    awaiting_confirmations: "Ожидает подтверждений",
    registering: "Регистрация в сети",
    registered: "Зарегистрирована",
    syncing: "Синхронизация",
    running: "Работает",
    activeState: "Активна",
    online: "Доступна",
    stopped: "Остановлена",
    offline: "Нет связи",
    retiring: "Вывод обеспечения",
    retired: "Выведена из работы",
    unknown: "Проверяется",
    broadcast: "Транзакция отправлена",
    broadcast_unknown: "Отправка требует сверки",
    signingState: "Подписание",
    signed: "Подписано",
    failed: "Требует внимания",
    cancelled: "Отменено",
    start: "Запустить",
    stop: "Остановить",
    retire: "Вывести обеспечение",
    stopNote: "Остановка узла не разблокирует обеспечение.",
    lockedStatus: "Обеспечение заблокировано",
    unlockedStatus: "Обеспечение не заблокировано",
    lockUnknown: "Состояние обеспечения проверяется",
    confirmations: "Подтверждения",
    txid: "Транзакция обеспечения",
    registration: "Регистрация",
    synchronized: "Синхронизирована",
    syncPending: "Синхронизация не подтверждена",
    yes: "Подтверждена",
    no: "Ожидается",
    details: "Данные узла",
    close: "Закрыть",
    back: "Назад",
    retireTitle: "Вывести обеспечение",
    retireBody:
      "Узел будет выведен из работы. Кошелёк подготовит отдельную операцию возврата обеспечения под ваше одобрение. Награды для этой мастерноды прекратятся после её исключения из сети.",
    retireAction: "Проверить вывод обеспечения",
    retireApprove: "Одобрить вывод",
    retireRecipient: "Адрес возврата",
    retireTotal: "Вернётся в кошелёк",
    process:
      "Операция уже выполняется. Обновление страницы не запускает повторную подпись.",
    helpTitle: "Монеты ваши. У обеспечения есть правила.",
    helpText:
      "Блокировка резервирует выход транзакции в кошельке. Остановка программы не снимает её. Для вывода нужна отдельная операция; расходование обеспечения исключает мастерноду из сети.",
    helpNote:
      "Мастерноды получают долю награды за обслуживание сети. Новые блоки создают майнеры.",
    copy: "Копировать",
    copied: "Скопировано",
    copyError: "Выделите и скопируйте значение вручную.",
    emptyName: "Введите название мастерноды.",
  },
  en: {
    eyebrow: "LAVE / YOUR PART IN THE NETWORK",
    title: "Your node.\nA stronger network.",
    intro:
      "Launch masternodes from your wallet. Manage collateral, monitor your nodes and track received rewards in one place.",
    launch: "Create masternode",
    collateral: "Collateral per masternode",
    collateralShort: "Collateral",
    local: "On this computer",
    localNote:
      "Local LAVE test network. Management is for the trusted operator of this computer.",
    available: "Available to launch",
    locked: "Locked collateral",
    rewards: "Received rewards",
    rewardsNote: "Mature payments to the current masternode",
    immatureRewards: "Still maturing",
    unknownRewards: "Reward observations are not available yet",
    active: "Active masternodes",
    totalNodes: "Total in this wallet",
    nodes: "My masternodes",
    nodesNote: "Your wallet keeps control of the collateral.",
    refresh: "Refresh",
    refreshed: "Observed",
    loading: "Checking wallet and masternodes…",
    error: "Masternode status could not be loaded.",
    stale:
      "Fresh observations are unavailable. Actions are temporarily disabled.",
    recovery:
      "This wallet was restored from a backup. Signing remains locked until its history is reconciled.",
    unsupported:
      "Masternode management is available on the local LAVE network.",
    empty: "Your first masternode",
    emptyBody:
      "A dedicated node supporting the network. Start with your available coins — the wallet shows the exact transaction fee and asks for approval before launch.",
    need: "Required to launch",
    plusFee: "+ network fee",
    insufficient: "Not enough available coins for the collateral and fee.",
    privateFee:
      "Registration needs confirmed wallet change for its fee. Collateral stays locked; invoice-address funds are excluded from this fee payment.",
    unavailable: "Launch is currently unavailable. Refresh the wallet status.",
    fund: "Open the wallet to copy your receiving address and add funds.",
    onlineRule: "Keep this computer powered on and connected to the network.",
    lockRule: "Collateral is excluded from ordinary wallet payments.",
    payoutRule:
      "Rewards depend on blocks and network rules; no fixed return is promised.",
    prepare: "Prepare launch",
    name: "Masternode name",
    namePlaceholder: "My masternode",
    localMachine: "Local node",
    localMachineNote:
      "The service creates a separate node process on this computer.",
    configuration: "Configure",
    collateral_pending: "Confirming collateral",
    collateral_ready: "Ready to register",
    registration_pending: "Confirming registration",
    draft: "Collateral not sent",
    register: "Register node",
    registrationKind: "Masternode registration",
    collateralKind: "Reserve collateral",
    retireKind: "Return collateral",
    registrationHelp:
      "Collateral is confirmed and remains locked. Registration requires a second approval and a separate transaction fee.",
    collateralHelp:
      "Confirm the collateral in a block, then approve the separate masternode registration.",
    waitingBlock:
      "Waiting for a block confirmation. Coins are already reserved; no further signature is needed.",
    registrationDebit: "Additional debit",
    alreadyLocked: "Already locked",
    cancel: "Cancel preparation",
    retry: "Retry same broadcast",
    configured: "Masternode created",
    finalityPending:
      "The withdrawal has a block confirmation. A replacement masternode becomes available once its ChainLock is verified.",
    previousRunning:
      "Stop the previous node before creating a replacement. Withdrawing collateral and stopping the node are separate actions.",
    coreState: "LAVE Core node state",
    WAITING_FOR_PROTX: "Awaiting registration",
    POSE_BANNED: "Banned by network",
    REMOVED: "Removed from network",
    OPERATOR_KEY_CHANGED: "Operator key changed",
    PROTX_IP_CHANGED: "Node address changed",
    ERROR: "Node error",
    UNKNOWN: "Checking",
    retire_pending: "Confirming withdrawal",
    review: "Review",
    confirm: "Approve",
    newTitle: "New masternode",
    newNote: "Configure your node. Next, review the actual transaction.",
    fee: "Transaction fee",
    calculated: "Calculated before approval",
    total: "Total required",
    signing: "Processing action…",
    approve: "Approve and continue",
    reviewTitle: "Review before signing",
    reviewNote:
      "Approval authorizes this wallet to sign and send only the operation shown here.",
    fingerprint: "Operation fingerprint",
    network: "Network",
    destination: "Collateral address",
    payout: "Payout address",
    service: "Node address",
    expires: "Approval expires",
    expired: "This approval has expired. Refresh the status.",
    preparing: "Preparing",
    prepared: "Awaiting approval",
    funding: "Collateral sent",
    awaiting_funding: "Awaiting collateral",
    awaiting_confirmations: "Awaiting confirmations",
    registering: "Registering on chain",
    registered: "Registered",
    syncing: "Synchronizing",
    running: "Running",
    activeState: "Active",
    online: "Online",
    stopped: "Stopped",
    offline: "Offline",
    retiring: "Withdrawing collateral",
    retired: "Retired",
    unknown: "Checking",
    broadcast: "Transaction sent",
    broadcast_unknown: "Broadcast needs reconciliation",
    signingState: "Signing",
    signed: "Signed",
    failed: "Needs attention",
    cancelled: "Cancelled",
    start: "Start",
    stop: "Stop",
    retire: "Withdraw collateral",
    stopNote: "Stopping a node does not unlock its collateral.",
    lockedStatus: "Collateral locked",
    unlockedStatus: "Collateral is not locked",
    lockUnknown: "Checking collateral state",
    confirmations: "Confirmations",
    txid: "Collateral transaction",
    registration: "Registration",
    synchronized: "Synchronized",
    syncPending: "Synchronization not confirmed",
    yes: "Confirmed",
    no: "Pending",
    details: "Node details",
    close: "Close",
    back: "Back",
    retireTitle: "Withdraw collateral",
    retireBody:
      "The node will retire. Your wallet prepares a separate collateral return for your approval. This masternode stops earning rewards once it is removed from the network.",
    retireAction: "Review collateral withdrawal",
    retireApprove: "Approve withdrawal",
    retireRecipient: "Return address",
    retireTotal: "Returned to wallet",
    process:
      "This operation is already in progress. Refreshing the page never starts another signature.",
    helpTitle: "Your coins. Clear collateral rules.",
    helpText:
      "The lock reserves a transaction output in the wallet. Stopping the process leaves the lock in place. Withdrawing is a separate operation; spending the collateral removes the masternode from the network.",
    helpNote:
      "Masternodes receive a share of rewards for serving the network. Miners create new blocks.",
    copy: "Copy",
    copied: "Copied",
    copyError: "Select and copy the value manually.",
    emptyName: "Enter a name for your masternode.",
  },
};

function Amount({ value, locale, currency = "LAVE", className = "" }) {
  // Preserve every displayed satoshi; review amounts come from decimal strings.
  const raw =
    typeof value === "string"
      ? value
      : typeof value === "number" && Number.isFinite(value)
        ? value.toFixed(8)
        : "";
  const parts = /^(\d+)(?:\.(\d{1,8}))?$/.exec(raw);
  const fraction = parts?.[2]?.replace(/0+$/, "") || "";
  const formatted = parts
    ? BigInt(parts[1]).toLocaleString(locale === "ru" ? "ru-RU" : "en-GB") +
      (fraction ? (locale === "ru" ? "," : ".") + fraction : "")
    : "—";
  return (
    <strong className={"wm-amount " + className}>
      {formatted}
      <small>{currency}</small>
    </strong>
  );
}

function CopyField({ label, value, t }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      setError(false);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(true);
    }
  }
  return (
    <div className="wm-copy">
      <span>{label}</span>
      <div>
        <code>{value ?? "—"}</code>
        {value && (
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? t.copied : t.copy}
            title={copied ? t.copied : t.copy}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        )}
      </div>
      {error && <small role="status">{t.copyError}</small>}
    </div>
  );
}

function NodeEmblem({ large = false }) {
  return (
    <div
      className={"wm-emblem" + (large ? " wm-emblem-large" : "")}
      aria-hidden="true"
    >
      <div className="wm-emblem-orbit orbit-one" />
      <div className="wm-emblem-orbit orbit-two" />
      <div className="wm-emblem-core">
        <Layers3 size={large ? 39 : 27} strokeWidth={1.4} />
      </div>
      {large && (
        <>
          <span className="wm-emblem-dot dot-one" />
          <span className="wm-emblem-dot dot-two" />
          <span className="wm-emblem-dot dot-three" />
        </>
      )}
    </div>
  );
}

function stateLabel(state, t) {
  return (
    { active: t.activeState, signing: t.signingState }[state] ||
    t[state] ||
    state ||
    t.unknown
  );
}

function MasternodeCard({
  node,
  t,
  locale,
  currency,
  disabled,
  busy,
  onAction,
  onRetire,
  canPrepare,
  current,
}) {
  const working =
    current &&
    node.online === true &&
    node.registered === true &&
    node.synchronized === true &&
    node.masternodeState === "READY";
  const displayState = !current
    ? t.unknown
    : node.state === "retire_pending"
      ? t.retire_pending
      : working
        ? t.running
        : node.online &&
            node.masternodeState &&
            node.masternodeState !== "READY"
          ? stateLabel(node.masternodeState, t)
          : node.online && !node.synchronized
            ? t.syncing
            : node.state === "registered" && node.online === false
              ? t.stopped
              : stateLabel(node.state, t);
  return (
    <article className={"wm-node-card" + (working ? " is-working" : "")}>
      <div className="wm-node-top">
        <span className="wm-node-icon">
          <Server size={22} strokeWidth={1.5} />
        </span>
        <div>
          <h3>{node.name || node.id}</h3>
          <span>
            <Monitor size={11} />
            {t.localMachine}
          </span>
        </div>
        <span className={"wm-node-state" + (working ? " is-online" : "")}>
          <i />
          {displayState}
        </span>
      </div>
      <div className="wm-node-collateral">
        <span>{t.collateralShort}</span>
        <Amount
          value={node.collateralAmount}
          locale={locale}
          currency={currency}
        />
        <small className={node.collateralLocked === true ? "is-locked" : ""}>
          <LockKeyhole size={12} />
          {node.collateralLocked === true
            ? t.lockedStatus
            : node.collateralLocked === false
              ? t.unlockedStatus
              : t.lockUnknown}
        </small>
      </div>
      <div className="wm-node-facts">
        <div>
          <span>{t.rewards}</span>
          <Amount
            value={node.rewardsAmount}
            locale={locale}
            currency={currency}
          />
          {node.immatureRewardsAmount != null && (
            <small className="wm-reward-pending">
              <span>{t.immatureRewards}</span>
              <Amount
                value={node.immatureRewardsAmount}
                locale={locale}
                currency={currency}
              />
            </small>
          )}
        </div>
        <div>
          <span>{t.confirmations}</span>
          <strong>
            {Number.isInteger(node.confirmations) ? node.confirmations : "—"}
          </strong>
        </div>
      </div>
      <div className="wm-node-checks">
        <span className={node.registered === true ? "is-ready" : ""}>
          <CircleCheck size={13} />
          {t.registration}:{" "}
          {node.registered === true
            ? t.yes
            : node.registered === false
              ? t.no
              : t.unknown}
        </span>
        <span className={node.synchronized === true ? "is-ready" : ""}>
          <RefreshCw size={13} />
          {node.synchronized === true ? t.synchronized : t.syncPending}
        </span>
      </div>
      {node.error && (
        <p className="wm-inline-error" role="status">
          {node.error}
        </p>
      )}
      {node.state === "collateral_ready" && (
        <p className="wm-stage-note">{t.registrationHelp}</p>
      )}
      {["collateral_pending", "registration_pending"].includes(node.state) && (
        <p className="wm-stage-note">{t.waitingBlock}</p>
      )}
      <details className="wm-node-details">
        <summary>
          {t.details}
          <ChevronDown size={14} />
        </summary>
        <CopyField label={t.service} value={node.service} t={t} />
        <CopyField label={t.coreState} value={node.masternodeState} t={t} />
        <CopyField label={t.payout} value={node.payoutAddress} t={t} />
        <CopyField label={t.txid} value={node.collateralTxid} t={t} />
      </details>
      <div className="wm-node-actions">
        {node.canRegister === true ||
        ["collateral_ready", "draft"].includes(node.state) ? (
          <button
            className="wm-button"
            type="button"
            disabled={disabled || !canPrepare}
            onClick={() => onAction("prepare", { name: node.name })}
          >
            {busy === "prepare" ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <ShieldCheck size={15} />
            )}
            {node.state === "draft" ? t.prepare : t.register}
          </button>
        ) : node.canStop === true ? (
          <button
            className="wm-button wm-button-secondary"
            type="button"
            disabled={disabled}
            onClick={() => onAction("stop", { nodeId: node.id })}
          >
            {busy === "stop:" + node.id ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Pause size={15} />
            )}
            {t.stop}
          </button>
        ) : (
          <button
            className="wm-button wm-button-secondary"
            type="button"
            disabled={disabled || node.canStart !== true}
            onClick={() => onAction("start", { nodeId: node.id })}
          >
            {busy === "start:" + node.id ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Play size={15} />
            )}
            {t.start}
          </button>
        )}
        <button
          type="button"
          className="wm-text-button wm-retire-button"
          disabled={disabled || node.canRetire !== true}
          onClick={() => onRetire(node)}
        >
          {t.retire}
          <ArrowDownLeft size={14} />
        </button>
      </div>
      <p className="wm-stop-note">
        <LockKeyhole size={11} />
        {t.stopNote}
      </p>
    </article>
  );
}

export default function WalletMasternodes({
  active,
  locale,
  walletStatus,
  connected,
  csrfToken,
  onWalletRefresh,
}) {
  const t = words[locale] || words.en;
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [fetchError, setFetchError] = useState(""),
    [actionError, setActionError] = useState(""),
    [busy, setBusy] = useState(""),
    [mode, setMode] = useState(null),
    [name, setName] = useState(""),
    [review, setReview] = useState(null),
    [retiring, setRetiring] = useState(null);
  const inFlight = useRef(false),
    mutating = useRef(false),
    controller = useRef(null),
    panel = useRef(null),
    token = useRef(csrfToken);
  token.current = csrfToken;
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    controller.current = new AbortController();
    try {
      const response = await fetch("/api/wallet/masternodes", {
        credentials: "same-origin",
        signal: controller.current.signal,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message || `HTTP ${response.status}`);
      if (!result || !Array.isArray(result.nodes))
        throw new Error("Invalid masternode status response.");
      setData(result);
      setFetchError("");
      setReview(result.pendingReview || null);
      if (!result.pendingReview)
        setMode((previous) => (previous === "review" ? null : previous));
    } catch (error) {
      if (error.name !== "AbortError") setFetchError(error.message);
    } finally {
      inFlight.current = false;
      setRefreshing(false);
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!active) return;
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      clearInterval(timer);
      controller.current?.abort();
    };
  }, [active, refresh]);
  useEffect(() => {
    if ((mode || review) && active) {
      panel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      panel.current?.focus({ preventScroll: true });
    }
  }, [mode, review?.id, active]);
  async function action(which, body) {
    if (mutating.current || !token.current || !connected || fetchError) return;
    mutating.current = true;
    setBusy(which + (body?.nodeId ? ":" + body.nodeId : ""));
    setActionError("");
    try {
      const response = await fetch("/api/wallet/masternodes/" + which, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": token.current,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message || `HTTP ${response.status}`);
      if (result.review) {
        setReview(result.review);
        setMode("review");
      } else if (which.includes("approve")) {
        setReview(null);
        setMode(null);
        setRetiring(null);
      }
      await refresh();
      await onWalletRefresh?.();
    } catch (error) {
      setActionError(error.message || t.error);
      await refresh();
    } finally {
      mutating.current = false;
      setBusy("");
    }
  }
  if (!active) return null;
  const currency = data?.currency || "LAVE";
  const current = Boolean(data && !fetchError && connected);
  const recoveryLocked =
    data?.recoveryLocked === true || walletStatus?.recoveryLocked === true;
  const disabled =
    !current ||
    Boolean(busy) ||
    !csrfToken ||
    recoveryLocked ||
    data?.supported === false;
  const nodes = data?.nodes || [];
  const collateral = data?.collateralAmount;
  const canCreate =
    (data?.canPrepare === true || data?.canCreate === true) &&
    nodes.every((node) => node.state === "retired");
  const countActive = nodes.filter(
    (n) =>
      n.online === true &&
      n.registered === true &&
      n.synchronized === true &&
      n.masternodeState === "READY",
  ).length;
  const isRetire =
    review?.kind === "retire" ||
    review?.kind === "retirement" ||
    mode === "retire";
  const expired = Boolean(
    review?.expiresAt && Date.parse(review.expiresAt) <= Date.now(),
  );
  const prepared = review?.state === "prepared";
  const isRegistration = review?.kind === "register";
  const canRetry = ["signed", "broadcast_unknown"].includes(review?.state);
  const observed = data?.observedAt && new Date(data.observedAt);
  function openCreate() {
    setMode("create");
    setReview(null);
    setRetiring(null);
    setActionError("");
  }
  function openRetire(node) {
    setRetiring(node);
    setReview(null);
    setMode("retire");
    setActionError("");
  }
  return (
    <div className="wallet-masternodes">
      <section className="wm-hero">
        <div className="wm-hero-copy">
          <div className="wm-eyebrow">
            <span />
            {t.eyebrow}
          </div>
          <h1>{t.title}</h1>
          <p>{t.intro}</p>
          <button
            type="button"
            className="wm-button wm-button-light"
            onClick={openCreate}
            disabled={disabled || !canCreate || Boolean(review)}
          >
            <Plus size={17} />
            {nodes.some((node) => node.state !== "retired")
              ? t.configured
              : t.launch}
            <ArrowRight size={17} />
          </button>
        </div>
        <div className="wm-hero-collateral">
          <NodeEmblem large />
          <span>{t.collateral}</span>
          <Amount value={collateral} locale={locale} currency={currency} />
          <small>
            <LockKeyhole size={12} />
            {t.lockRule}
          </small>
        </div>
      </section>
      <div className="wm-local-note">
        <Monitor size={15} />
        <strong>{t.local}</strong>
        <span>{t.localNote}</span>
      </div>
      {fetchError && (
        <div className="wm-notice wm-notice-error" role="alert">
          <CircleAlert size={19} />
          <div>
            <strong>{t.stale}</strong>
            <p>{fetchError}</p>
          </div>
          <button type="button" onClick={refresh} disabled={refreshing}>
            {t.refresh}
          </button>
        </div>
      )}
      {recoveryLocked && (
        <div className="wm-notice" role="status">
          <LockKeyhole size={18} />
          <p>{t.recovery}</p>
        </div>
      )}
      {data?.supported === false && (
        <div className="wm-notice" role="status">
          <Info size={18} />
          <p>{data.reason || t.unsupported}</p>
        </div>
      )}
      <div className="wm-metrics">
        <div>
          <span>
            <Wallet size={15} />
            {t.available}
          </span>
          <Amount
            value={current ? data.availableAmount : null}
            locale={locale}
            currency={currency}
          />
          <small>
            {t.need} {collateral ?? "—"} {currency} {t.plusFee}
          </small>
        </div>
        <div>
          <span>
            <LockKeyhole size={15} />
            {t.locked}
          </span>
          <Amount
            value={current ? data.lockedAmount : null}
            locale={locale}
            currency={currency}
          />
          <small>{t.nodesNote}</small>
        </div>
        <div>
          <span>
            <Coins size={15} />
            {t.rewards}
          </span>
          <Amount
            value={current ? data.rewardsAmount : null}
            locale={locale}
            currency={currency}
          />
          <small>
            {data?.rewardsAmount == null ? t.unknownRewards : t.rewardsNote}
          </small>
          {data?.immatureRewardsAmount != null && (
            <div className="wm-reward-pending">
              <span>{t.immatureRewards}</span>
              <Amount
                value={current ? data.immatureRewardsAmount : null}
                locale={locale}
                currency={currency}
              />
            </div>
          )}
        </div>
        <div>
          <span>
            <Server size={15} />
            {t.active}
          </span>
          <strong className="wm-count">
            {current ? countActive : "—"}
            <small>/ {data ? nodes.length : "—"}</small>
          </strong>
          <small>{t.totalNodes}</small>
        </div>
      </div>
      {current &&
        [
          "RETIREMENT_FINALITY_PENDING",
          "NODE_RUNNING",
          "INSUFFICIENT_PRIVATE_FEE_INPUT",
        ].includes(data.prepareDisabledReason) && (
          <div className="wm-notice" role="status">
            <Info size={18} />
            <p>
              {data.prepareDisabledReason === "RETIREMENT_FINALITY_PENDING"
                ? t.finalityPending
                : data.prepareDisabledReason ===
                    "INSUFFICIENT_PRIVATE_FEE_INPUT"
                  ? t.privateFee
                  : t.previousRunning}
            </p>
          </div>
        )}
      <div className="wm-section-heading">
        <div>
          <h2>
            {t.nodes}
            <span>{data ? nodes.length : "—"}</span>
          </h2>
          <p>{t.nodesNote}</p>
        </div>
        <button
          type="button"
          className="wm-text-button"
          onClick={refresh}
          disabled={refreshing}
        >
          {refreshing ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          {t.refresh}
        </button>
      </div>
      {loading ? (
        <div className="wm-loading">
          <LoaderCircle size={20} className="spin" />
          {t.loading}
        </div>
      ) : !data ? (
        <div className="wm-loading">
          <CircleAlert size={20} />
          {t.error}
        </div>
      ) : nodes.length ? (
        <div className="wm-node-grid">
          {nodes.map((node) => (
            <MasternodeCard
              key={node.id}
              node={node}
              t={t}
              locale={locale}
              currency={currency}
              disabled={disabled}
              busy={busy}
              onAction={action}
              onRetire={openRetire}
              canPrepare={data?.canPrepare === true}
              current={current}
            />
          ))}
        </div>
      ) : (
        <section className="wm-empty">
          <div className="wm-empty-main">
            <NodeEmblem />
            <div>
              <h3>{t.empty}</h3>
              <p>{t.emptyBody}</p>
              <button
                type="button"
                className="wm-button"
                onClick={openCreate}
                disabled={disabled || !canCreate || Boolean(review)}
              >
                <Plus size={16} />
                {t.launch}
              </button>
            </div>
          </div>
          <div className="wm-empty-requirements">
            <span>{t.need}</span>
            <Amount value={collateral} locale={locale} currency={currency} />
            <small>{t.plusFee}</small>
            {current && !canCreate && (
              <p>
                <CircleAlert size={14} />
                {{
                  INSUFFICIENT_FUNDS: t.insufficient,
                  INSUFFICIENT_PRIVATE_FEE_INPUT: t.privateFee,
                  RECOVERY_LOCKED: t.recovery,
                  OPERATION_PENDING: t.process,
                  COLLATERAL_PENDING: t.waitingBlock,
                  ALREADY_REGISTERED: t.configured,
                  RETIREMENT_FINALITY_PENDING: t.finalityPending,
                  NODE_RUNNING: t.previousRunning,
                }[data?.prepareDisabledReason] || t.unavailable}
              </p>
            )}
            <ul>
              <li>
                <LockKeyhole size={15} />
                {t.lockRule}
              </li>
              <li>
                <Cpu size={15} />
                {t.onlineRule}
              </li>
            </ul>
          </div>
        </section>
      )}
      {(mode || review) && (
        <section
          className="wm-operation"
          ref={panel}
          tabIndex={-1}
          aria-labelledby="wm-operation-title"
        >
          <div className="wm-operation-header">
            <div>
              <span className="wm-operation-icon">
                {isRetire ? (
                  <ArrowDownLeft size={20} />
                ) : (
                  <ShieldCheck size={20} />
                )}
              </span>
              <div>
                <h2 id="wm-operation-title">
                  {review
                    ? t.reviewTitle
                    : isRetire
                      ? t.retireTitle
                      : t.newTitle}
                </h2>
                <p>
                  {review
                    ? t.reviewNote
                    : isRetire
                      ? retiring?.name
                      : t.newNote}
                </p>
              </div>
            </div>
            {!review && (
              <button
                type="button"
                className="wm-icon-button"
                aria-label={t.close}
                disabled={Boolean(busy)}
                onClick={() => {
                  setMode(null);
                  setReview(null);
                }}
              >
                <X size={19} />
              </button>
            )}
          </div>
          {!review && !isRetire ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!name.trim()) {
                  setActionError(t.emptyName);
                  return;
                }
                action("prepare", { name: name.trim() });
              }}
            >
              <div className="wm-steps">
                <span className="is-current">
                  <b>01</b>
                  {t.configuration}
                </span>
                <i />
                <span>
                  <b>02</b>
                  {t.review}
                </span>
                <i />
                <span>
                  <b>03</b>
                  {t.confirm}
                </span>
              </div>
              <div className="wm-setup-grid">
                <div>
                  <label htmlFor="wm-node-name">{t.name}</label>
                  <input
                    id="wm-node-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={40}
                    placeholder={t.namePlaceholder}
                    autoComplete="off"
                    disabled={Boolean(busy)}
                    required
                  />
                  <div className="wm-machine">
                    <Monitor size={20} />
                    <div>
                      <strong>{t.localMachine}</strong>
                      <p>{t.localMachineNote}</p>
                    </div>
                    <CircleCheck size={18} />
                  </div>
                </div>
                <dl className="wm-quote">
                  <div>
                    <dt>{t.collateralShort}</dt>
                    <dd>
                      <Amount
                        value={collateral}
                        locale={locale}
                        currency={currency}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>{t.fee}</dt>
                    <dd>{t.calculated}</dd>
                  </div>
                  <div>
                    <dt>{t.network}</dt>
                    <dd>
                      {data?.network?.devnetName || data?.network?.chain || "—"}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="wm-operation-footer">
                <p>
                  <Info size={15} />
                  {t.payoutRule}
                </p>
                <button
                  className="wm-button"
                  type="submit"
                  disabled={disabled || !canCreate || !name.trim()}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <ArrowRight size={16} />
                  )}
                  {busy ? t.signing : t.prepare}
                </button>
              </div>
            </form>
          ) : !review ? (
            <div className="wm-retire-review">
              <p>{t.retireBody}</p>
              <div className="wm-retire-amount">
                <LockKeyhole size={21} />
                <div>
                  <span>{t.collateralShort}</span>
                  <Amount
                    value={retiring?.collateralAmount}
                    locale={locale}
                    currency={currency}
                  />
                </div>
              </div>
              <button
                type="button"
                className="wm-button"
                disabled={disabled || retiring?.canRetire !== true}
                onClick={() =>
                  action("retire-prepare", { nodeId: retiring.id })
                }
              >
                {busy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <ArrowRight size={16} />
                )}
                {busy ? t.signing : t.retireAction}
              </button>
            </div>
          ) : (
            <div className="wm-review-body">
              <div
                className={
                  "wm-review-status" + (prepared ? " is-prepared" : "")
                }
              >
                <ShieldCheck size={17} />
                <strong>{stateLabel(review.state, t)}</strong>
                <span>
                  {isRegistration
                    ? t.registrationKind
                    : isRetire
                      ? t.retireKind
                      : t.collateralKind}
                </span>
              </div>
              <div className="wm-review-grid">
                <div>
                  <CopyField
                    label={isRetire ? t.retireRecipient : t.destination}
                    value={
                      isRetire
                        ? review.returnAddress
                        : review.collateralAddress || review.address
                    }
                    t={t}
                  />
                  {review.payoutAddress && (
                    <CopyField
                      label={t.payout}
                      value={review.payoutAddress}
                      t={t}
                    />
                  )}
                  <CopyField label={t.service} value={review.service} t={t} />
                  <CopyField
                    label={t.network}
                    value={review.network?.devnetName || review.network?.chain}
                    t={t}
                  />
                </div>
                <dl className="wm-quote wm-review-quote">
                  <div>
                    <dt>
                      {isRegistration ? t.alreadyLocked : t.collateralShort}
                    </dt>
                    <dd>
                      <Amount
                        value={review.collateralAmount}
                        locale={locale}
                        currency={currency}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>{t.fee}</dt>
                    <dd>
                      <Amount
                        value={review.fee}
                        locale={locale}
                        currency={currency}
                      />
                    </dd>
                  </div>
                  <div className="wm-quote-total">
                    <dt>
                      {isRetire
                        ? t.retireTotal
                        : isRegistration
                          ? t.registrationDebit
                          : t.total}
                    </dt>
                    <dd>
                      <Amount
                        value={review.total}
                        locale={locale}
                        currency={currency}
                      />
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="wm-fingerprint">
                <Fingerprint size={21} />
                <CopyField
                  label={t.fingerprint}
                  value={review.fingerprint}
                  t={t}
                />
              </div>
              {review.expiresAt && (
                <p className="wm-expiry">
                  {t.expires}:{" "}
                  {new Date(review.expiresAt).toLocaleString(
                    locale === "ru" ? "ru-RU" : "en-GB",
                  )}
                </p>
              )}
              {expired && <p className="wm-inline-error">{t.expired}</p>}
              {prepared ? (
                <div className="wm-operation-footer">
                  <p>
                    <LockKeyhole size={15} />
                    {isRetire
                      ? t.retireBody
                      : isRegistration
                        ? t.registrationHelp
                        : t.collateralHelp}
                  </p>
                  <div className="wm-approval-buttons">
                    <button
                      type="button"
                      className="wm-button wm-button-secondary"
                      disabled={disabled}
                      onClick={() => action("cancel", { requestId: review.id })}
                    >
                      {t.cancel}
                    </button>
                    <button
                      type="button"
                      className="wm-button"
                      disabled={disabled || expired || !review.fingerprint}
                      onClick={() =>
                        action(isRetire ? "retire-approve" : "approve", {
                          requestId: review.id,
                          fingerprint: review.fingerprint,
                        })
                      }
                    >
                      {busy ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        <Fingerprint size={17} />
                      )}
                      {busy
                        ? t.signing
                        : isRetire
                          ? t.retireApprove
                          : t.approve}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="wm-operation-footer">
                  <p>
                    <Info size={16} />
                    {review.state === "broadcast" ? t.waitingBlock : t.process}
                  </p>
                  {canRetry ? (
                    <button
                      type="button"
                      className="wm-button"
                      disabled={disabled || !review.fingerprint}
                      onClick={() =>
                        action(isRetire ? "retire-approve" : "approve", {
                          requestId: review.id,
                          fingerprint: review.fingerprint,
                        })
                      }
                    >
                      <RefreshCw size={15} />
                      {t.retry}
                    </button>
                  ) : (
                    <button
                      className="wm-button wm-button-secondary"
                      type="button"
                      onClick={refresh}
                      disabled={refreshing}
                    >
                      <RefreshCw size={15} />
                      {t.refresh}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}
      {actionError && (
        <div className="wm-notice wm-notice-error" role="alert">
          <CircleAlert size={18} />
          <p>{actionError}</p>
        </div>
      )}
      <section className="wm-help">
        <span className="wm-help-icon">
          <LockKeyhole size={22} strokeWidth={1.5} />
        </span>
        <div>
          <h3>{t.helpTitle}</h3>
          <p>{t.helpText}</p>
          <details>
            <summary>
              {t.payoutRule}
              <ChevronDown size={14} />
            </summary>
            <p>{t.helpNote}</p>
          </details>
        </div>
      </section>
      <div className="wm-observed">
        <span>
          <Globe2 size={12} />
          {data?.network?.devnetName || "LAVE"}
        </span>
        <span>
          {t.refreshed}:{" "}
          {observed && !Number.isNaN(observed.getTime())
            ? observed.toLocaleTimeString(locale === "ru" ? "ru-RU" : "en-GB")
            : "—"}
        </span>
      </div>
    </div>
  );
}
