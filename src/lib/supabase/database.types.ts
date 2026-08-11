/**
 * Types des tables Supabase (miroir de `supabase/schema.sql`).
 * Regenerables avec : npx supabase gen types typescript --project-id <id>
 */

export type ProfileRow = {
  id: string
  user_id: string | null
  name: string
  phone: string | null
  email: string | null
  avatar: string | null
  color: string | null
  created_by: string | null
  claim_token: string
  created_at: string
}

export type GroupRow = {
  id: string
  name: string
  emoji: string
  owner_id: string
  created_at: string
}

export type GroupMemberRow = {
  group_id: string
  user_id: string
}

export type ExpenseRow = {
  id: string
  group_id: string | null
  payer_id: string
  amount: number
  motive: string
  split_type: 'equal' | 'custom' | 'items'
  status: 'pending' | 'confirmed'
  cancelled: boolean
  created_by: string
  created_at: string
}

export type ExpenseShareRow = {
  expense_id: string
  user_id: string
  share_amount: number
}

export type SettlementRow = {
  id: string
  from_user: string
  to_user: string
  amount: number
  note: string | null
  method: 'cash' | 'transfer'
  status: 'pending' | 'confirmed'
  cancelled: boolean
  created_at: string
  confirmed_at: string | null
}

export type LedgerEntryRow = {
  id: string
  user_a: string
  user_b: string
  amount: number
  ref_type: 'expense' | 'settlement' | 'adjustment'
  ref_id: string
  status: 'pending' | 'confirmed'
  label: string
  created_at: string
}

type Table<Row> = {
  Row: Row
  Insert: Partial<Row>
  Update: Partial<Row>
  Relationships: []
}

/** `{ [_ in never]: never }` : forme attendue par postgrest-js pour un
 *  espace vide (un `Record<string, never>` casse la contrainte GenericSchema
 *  et fait retomber toutes les tables sur `never`). */
type Empty = { [_ in never]: never }

export interface Database {
  public: {
    Tables: {
      profiles: Table<ProfileRow>
      groups: Table<GroupRow>
      group_members: Table<GroupMemberRow>
      expenses: Table<ExpenseRow>
      expense_shares: Table<ExpenseShareRow>
      settlements: Table<SettlementRow>
      ledger_entries: Table<LedgerEntryRow>
    }
    Views: Empty
    Functions: Empty
    Enums: {
      split_type: 'equal' | 'custom' | 'items'
      movement_status: 'pending' | 'confirmed'
    }
    CompositeTypes: Empty
  }
}
