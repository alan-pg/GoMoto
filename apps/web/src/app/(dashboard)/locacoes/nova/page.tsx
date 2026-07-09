import { RentalForm } from '../_components/RentalForm'

export default async function NovaLocacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ customer_id?: string }>
}) {
  const { customer_id } = await searchParams
  return <RentalForm defaultCustomerId={customer_id} />
}
