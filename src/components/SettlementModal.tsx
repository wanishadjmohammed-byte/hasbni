'use client'

import clsx from 'clsx'
import { Banknote, Landmark } from 'lucide-react'
import { useEffect, useState } from 'react'
import Avatar from './Avatar'
import Modal from './Modal'
import { useApp } from '@/context/AppContext'
import { formatAmount, relationBalance, round } from '@/lib/ledger'
import type { ID } from '@/lib/types'

export default function SettlementModal({
  open,
  onClose,
  otherId,
}: {
  open: boolean
  onClose: () => void
  otherId: ID | null
}) {
  const { state, me, addSettlement, toast } = useApp()
  const other = state.users.find((u) => u.id === otherId)
  const net = otherId ? relationBalance(state.ledger, me.id, otherId) : 0

  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [method, setMethod] = useState<'cash' | 'transfer'>('cash')
  // Sens par defaut : si je dois, je rembourse ; sinon j'enregistre ce qu'il m'a rendu.
  const [direction, setDirection] = useState<'me_to_them' | 'them_to_me'>('me_to_them')

  useEffect(() => {
    if (!open) return
    setAmount(net !== 0 ? String(Math.abs(net)) : '')
    setNote('')
    setMethod('cash')
    setDirection(net < 0 ? 'me_to_them' : 'them_to_me')
  }, [open, net])

  if (!other || !otherId) return null

  const value = round(Number(amount) || 0)
  const canSubmit = value > 0

  const submit = () => {
    if (!canSubmit) return
    addSettlement({
      fromUser: direction === 'me_to_them' ? me.id : otherId,
      toUser: direction === 'me_to_them' ? otherId : me.id,
      amount: value,
      note,
      method,
    })
    toast(
      direction === 'me_to_them'
        ? `Remboursement envoye — en attente de ${other.name}`
        : `Remboursement enregistre — en attente de confirmation`,
      'info'
    )
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Enregistrer un remboursement"
      subtitle="Le beneficiaire doit confirmer la reception"
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-silver tap px-4 text-sm font-semibold text-navy/50 transition-colors hover:bg-white/50 hover:text-navy"
          >
            Annuler
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-xl bg-brand tap px-5 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean disabled:cursor-not-allowed disabled:opacity-40"
          >
            Enregistrer
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="glass-sm flex items-center gap-3 rounded-2xl p-3">
          <Avatar user={other} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-navy">{other.name}</p>
            <p className="text-xs font-medium text-navy/50">
              {net > 0
                ? `Il te doit ${formatAmount(net)}`
                : net < 0
                  ? `Tu lui dois ${formatAmount(net)}`
                  : 'Vous etes a jour'}
            </p>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-navy/50">Sens du remboursement</p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['me_to_them', `Je rembourse ${other.name}`],
                ['them_to_me', `${other.name} me rembourse`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setDirection(key)}
                className={clsx(
                  'rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors',
                  direction === key
                    ? 'border-brand/45 bg-brand/10 text-navy'
                    : 'border-silver text-navy/50 hover:bg-white/50 hover:text-navy'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-navy/50">Montant (DA)</label>
          <input
            type="number"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="1000"
          />
          {net !== 0 && (
            <button
              onClick={() => setAmount(String(Math.abs(net)))}
              className="mt-2 rounded-lg border border-silver px-2.5 py-1 text-[11px] font-semibold text-navy/50 transition-colors hover:bg-white/50 hover:text-navy"
            >
              Solder tout : {formatAmount(net)}
            </button>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-navy/50">Moyen</p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['cash', 'Especes', Banknote],
                ['transfer', 'Virement', Landmark],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setMethod(key)}
                className={clsx(
                  'flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors',
                  method === key
                    ? 'border-brand/45 bg-brand/10 text-navy'
                    : 'border-silver text-navy/50 hover:bg-white/50 hover:text-navy'
                )}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-navy/50">Note (optionnel)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Rendu en cash au cafe"
          />
        </div>
      </div>
    </Modal>
  )
}
