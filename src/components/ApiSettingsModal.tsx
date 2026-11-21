"use client";

import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  Cloud,
  CloudOff,
  Loader2,
  LogOut,
  RefreshCw,
  UserRound,
} from "lucide-react";
import type { SyncInfo } from "@/components/StreamexApp";
import type { AccountSession, ApiCredentials, ApiHealth, Platform } from "@/types/streamex";
import { cn, EASE_OUT, formatRelativeDate } from "@/lib/utils";
import { PlatformBadge } from "@/components/StreamexLogo";
import { Modal } from "@/components/Modal";

interface ApiSettingsModalProps {
  open: boolean;
  session: AccountSession;
  credentials: ApiCredentials;
  apiHealth: ApiHealth;
  syncing: boolean;
  lastSyncAt: number | null;
  syncMessage: string | null;
  onClose: () => void;
  onSaveCredentials: (creds: ApiCredentials) => void;
  onSyncTwitch: () => void;
  onDisconnect: (platform: Platform) => void;
  syncInfo: SyncInfo;
  onSyncNow: () => void;
}

const healthLabel = (h: ApiHealth["twitch"] | ApiHealth["kick"]) =>
  h === "official"
    ? "API oficial"
    : h === "public"
      ? "Modo público"
      : h === "needs_key"
        ? "Sem chave"
        : "Fora do ar";

export function ApiSettingsModal({
  open,
  session,
  credentials,
  apiHealth,
  syncing,
  lastSyncAt,
  syncMessage,
  onClose,
  onSaveCredentials,
  onSyncTwitch,
  onDisconnect,
  syncInfo,
  onSyncNow,
}: ApiSettingsModalProps) {
  const [form, setForm] = useState<ApiCredentials>(credentials);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [origin, setOrigin] = useState("");

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from props/browser state
    setForm(credentials);
    setSaved(false);
    setOrigin(window.location.origin);
  }, [credentials, open]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveCredentials(form);
    setSaved(true);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Contas"
      subtitle="Conecte a Twitch e a Kick para trazer seus canais."
      icon={<UserRound className="h-4 w-4" />}
      className="sm:max-w-lg"
    >
      <div className="px-5 sm:px-6 pb-6 space-y-3">
        <SyncRow
          info={syncInfo}
          signedIn={Boolean(session.twitch || session.kick)}
          onSyncNow={onSyncNow}
        />
        <AccountRow
          platform="twitch"
          account={session.twitch}
          loginAvailable={session.twitchLoginAvailable}
          health={healthLabel(apiHealth.twitch)}
          onDisconnect={() => onDisconnect("twitch")}
        >
          {session.twitch && (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.04] px-3.5 py-3">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-white">Canais seguidos</div>
                <div className="text-[12px] text-white/45 truncate">
                  {syncMessage ??
                    (lastSyncAt
                      ? `Sincronizado ${formatRelativeDate(new Date(lastSyncAt).toISOString()).toLowerCase()}`
                      : "Ainda não sincronizado")}
                </div>
              </div>
              <button
                onClick={onSyncTwitch}
                disabled={syncing}
                className="press shrink-0 inline-flex items-center gap-1.5 rounded-full bg-white text-black px-3.5 py-1.5 text-[13px] font-semibold hover:bg-white/90 disabled:opacity-50"
              >
                {syncing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {syncing ? "Importando" : "Importar"}
              </button>
            </div>
          )}
        </AccountRow>

        <AccountRow
          platform="kick"
          account={session.kick}
          loginAvailable={session.kickLoginAvailable}
          health={healthLabel(apiHealth.kick)}
          onDisconnect={() => onDisconnect("kick")}
        >
          {session.kick && (
            <p className="rounded-2xl bg-white/[0.04] px-3.5 py-3 text-[12px] leading-relaxed text-white/55">
              A API oficial da Kick não fornece quem você segue. Com a{" "}
              <strong className="font-medium text-white/80">extensão do Streamex</strong> (v1.2+)
              instalada, é só abrir o kick.com logado uma vez — seus canais seguidos entram aqui
              sozinhos.
            </p>
          )}
        </AccountRow>

        {(!session.twitchLoginAvailable || !session.kickLoginAvailable) && (
          <p className="px-1 text-[12px] leading-relaxed text-white/45">
            O login precisa das variáveis <code className="text-white/70">TWITCH_CLIENT_ID</code>,{" "}
            <code className="text-white/70">TWITCH_CLIENT_SECRET</code>,{" "}
            <code className="text-white/70">KICK_CLIENT_ID</code> e{" "}
            <code className="text-white/70">KICK_CLIENT_SECRET</code> na Vercel, e da URL{" "}
            <code className="text-white/70 break-all">{origin}</code> cadastrada como URL de
            redirecionamento no app de cada plataforma.
          </p>
        )}

        {/* Advanced: browser-only keys (status + VODs without server env) */}
        <div className="rounded-3xl border border-white/[0.07]">
          <button
            type="button"
            onClick={() => setAdvancedOpen((o) => !o)}
            aria-expanded={advancedOpen}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
          >
            <span>
              <span className="block text-[13px] font-medium text-white/85">
                Chaves de API no navegador
              </span>
              <span className="block text-[12px] text-white/40">
                Avançado — só se não usar as variáveis da Vercel
              </span>
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-white/40 transition-transform duration-200",
                advancedOpen && "rotate-180",
              )}
            />
          </button>

          <AnimatePresence initial={false}>
            {advancedOpen && (
              <motion.div
                key="advanced-form"
                initial={{ height: 0, opacity: 0 }}
                animate={{
                  height: "auto",
                  opacity: 1,
                  transition: { duration: 0.22, ease: EASE_OUT },
                }}
                exit={{
                  height: 0,
                  opacity: 0,
                  transition: { duration: 0.16, ease: EASE_OUT },
                }}
                className="overflow-hidden"
              >
                <form onSubmit={handleSave} className="px-4 pb-4 space-y-3">
                  {(
                    [
                      ["twitchClientId", "Twitch Client ID", "text"],
                      ["twitchClientSecret", "Twitch Client Secret", "password"],
                      ["kickClientId", "Kick Client ID", "text"],
                      ["kickClientSecret", "Kick Client Secret", "password"],
                    ] as const
                  ).map(([key, label, type]) => (
                    <label key={key} className="block">
                      <span className="block text-[12px] text-white/50 mb-1">{label}</span>
                      <input
                        type={type}
                        value={form[key]}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => {
                          setForm({ ...form, [key]: e.target.value });
                          setSaved(false);
                        }}
                        className="w-full rounded-xl border border-white/[0.1] bg-black/50 px-3 py-2.5 text-[16px] sm:text-[13px] font-mono text-white focus:border-white/40 focus:outline-none"
                      />
                    </label>
                  ))}
                  <p className="text-[12px] text-white/40 leading-relaxed">
                    Ficam só neste navegador e vão por HTTPS para as rotas do Streamex. O login com
                    a conta não usa estas chaves.
                  </p>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="press inline-flex items-center gap-1.5 rounded-full bg-white text-black px-4 py-2 text-[13px] font-semibold hover:bg-white/90"
                    >
                      {saved && <Check className="pop h-3.5 w-3.5" />}
                      {saved ? "Salvo" : "Salvar chaves"}
                    </button>
                  </div>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Modal>
  );
}

function AccountRow({
  platform,
  account,
  loginAvailable,
  health,
  onDisconnect,
  children,
}: {
  platform: Platform;
  account: AccountSession["twitch"];
  loginAvailable: boolean;
  health: string;
  onDisconnect: () => void;
  children?: React.ReactNode;
}) {
  const name = platform === "kick" ? "Kick" : "Twitch";
  return (
    <section className="rounded-3xl bg-white/[0.03] border border-white/[0.06] p-3.5 space-y-3">
      <div className="flex items-center gap-3">
        {account?.avatarUrl ? (
          <img
            src={account.avatarUrl}
            alt=""
            className="h-10 w-10 rounded-full object-cover bg-white/5"
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.05]">
            <PlatformBadge platform={platform} size="md" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-white truncate">
            {account ? account.displayName : name}
          </div>
          <div className="text-[12px] text-white/45 truncate">
            {account ? `Conectado · @${account.login}` : `${health} · não conectado`}
          </div>
        </div>
        {account ? (
          <button
            onClick={onDisconnect}
            className="press shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] text-white/55 hover:bg-white/[0.06] hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sair
          </button>
        ) : loginAvailable ? (
          <a
            href={`/api/auth/${platform}/login`}
            className={cn(
              "press shrink-0 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold hover:brightness-110",
              platform === "kick" ? "bg-[#53FC18] text-black" : "bg-[#9146FF] text-white",
            )}
          >
            Conectar
          </a>
        ) : (
          <span className="shrink-0 rounded-full bg-white/[0.05] px-3 py-1.5 text-[12px] text-white/40">
            Indisponível
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function SyncRow({
  info,
  signedIn,
  onSyncNow,
}: {
  info: SyncInfo;
  signedIn: boolean;
  onSyncNow: () => void;
}) {
  const active = signedIn && info.status !== "off";
  const detail = !signedIn
    ? "Conecte a Twitch ou a Kick para levar canais, favoritos e progresso para qualquer aparelho."
    : info.status === "syncing"
      ? "Sincronizando…"
      : info.status === "error"
        ? "Não deu para sincronizar agora. Tentamos de novo em instantes."
        : info.status === "ok" && info.at
          ? `Canais, favoritos e progresso em todos os seus aparelhos · ${formatRelativeDate(new Date(info.at).toISOString()).toLowerCase()}`
          : "Sincronização indisponível no momento.";
  return (
    <section className="flex items-center gap-3 rounded-3xl bg-white/[0.03] border border-white/[0.06] p-3.5">
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
          active ? "bg-[#0A84FF]/15 text-[#64B5FF]" : "bg-white/[0.05] text-white/40",
        )}
      >
        {active ? (
          <Cloud className="h-[18px] w-[18px]" />
        ) : (
          <CloudOff className="h-[18px] w-[18px]" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-white">Sincronizar aparelhos</div>
        <div className="text-[12px] leading-snug text-white/45">{detail}</div>
      </div>
      {active && (
        <button
          onClick={onSyncNow}
          disabled={info.status === "syncing"}
          className="press shrink-0 flex h-8 w-8 items-center justify-center rounded-full text-white/55 hover:bg-white/[0.07] hover:text-white disabled:opacity-50"
          aria-label="Sincronizar agora"
          title="Sincronizar agora"
        >
          <RefreshCw className={cn("h-4 w-4", info.status === "syncing" && "animate-spin")} />
        </button>
      )}
    </section>
  );
}
