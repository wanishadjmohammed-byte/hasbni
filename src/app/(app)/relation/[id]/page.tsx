import RelationClient from '@/components/RelationClient'

export default async function RelationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <RelationClient userId={id} />
}
