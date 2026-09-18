'use client'

import clsx from 'clsx'
import Modal from './Modal'

/**
 * Confirmation pour les gestes irreversibles.
 *
 * Confirmer la reception d'un remboursement efface definitivement une creance,
 * et une annulation ecrit une contre-passation : les deux partaient sur un
 * simple tap, sans retour possible (audit UX-5).
 */
export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirmer',
  tone = 'brand',
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
  tone?: 'brand' | 'danger'
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="tap rounded-xl border border-silver px-4 text-sm font-semibold text-navy/60 transition-colors hover:bg-white/50 hover:text-navy"
          >
            Retour
          </button>
          <button
            onClick={() => {
              onConfirm()
              onClose()
            }}
            className={clsx(
              'tap rounded-xl px-5 text-sm font-semibold text-white shadow-sm transition-colors',
              tone === 'danger'
                ? 'bg-red-600 shadow-red-600/25 hover:bg-red-700'
                : 'bg-brand shadow-brand/25 hover:bg-ocean'
            )}
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      <p className="text-sm font-medium text-navy/70">{message}</p>
    </Modal>
  )
}
