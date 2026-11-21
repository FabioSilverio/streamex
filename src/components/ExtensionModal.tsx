"use client";

import React from "react";
import { CheckCircle2, Download, Puzzle } from "lucide-react";
import { Modal } from "@/components/Modal";

interface ExtensionModalProps {
  open: boolean;
  extensionConnected: boolean;
  syncedCount: number;
  onClose: () => void;
}

const STEPS = [
  <>
    Baixe e extraia <code className="text-white">streamex-extension.zip</code> numa pasta.
  </>,
  <>
    Abra <code className="text-white">chrome://extensions</code> (Chrome, Brave, Arc ou Edge).
  </>,
  <>
    Ative o <strong className="font-medium text-white">Modo do desenvolvedor</strong> e clique em{" "}
    <strong className="font-medium text-white">Carregar sem compactação</strong>.
  </>,
  <>Selecione a pasta extraída. Pronto — o progresso na Twitch e na Kick passa a ser salvo aqui.</>,
];

export function ExtensionModal({
  open,
  extensionConnected,
  syncedCount,
  onClose,
}: ExtensionModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Extensão do navegador"
      subtitle="Lembra onde você parou mesmo assistindo na Twitch.tv ou Kick.com."
      icon={<Puzzle className="h-4 w-4" />}
      className="sm:max-w-lg"
    >
      <div className="px-5 sm:px-6 pb-6 space-y-5">
        {extensionConnected && (
          <div className="flex items-center gap-3 rounded-2xl bg-[#53FC18]/10 px-4 py-3">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-[#53FC18]" />
            <div className="text-[13px] text-white/80">
              Conectada · <span className="tabular">{syncedCount}</span> vídeos sincronizados
            </div>
          </div>
        )}

        <a
          href="/streamex-extension.zip"
          download="streamex-extension.zip"
          className="press flex w-full items-center justify-center gap-2 rounded-full bg-white py-3 text-[15px] font-semibold text-black hover:bg-white/90"
        >
          <Download className="h-4 w-4" />
          Baixar extensão (.zip)
        </a>

        <ol className="space-y-3">
          {STEPS.map((step, i) => (
            <li
              key={i}
              className="flex items-start gap-3 text-[13px] leading-relaxed text-white/65"
            >
              <span className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-[12px] font-semibold text-white">
                {i + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </Modal>
  );
}
