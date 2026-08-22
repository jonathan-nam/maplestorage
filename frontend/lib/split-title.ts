/**
 * The title over a party's split, from the drop being divided.
 *
 * The catalog holds an item's full name, and for the one coupon that is "Vestige of Erion Coupon"
 * (catalog/drops.yaml). The count line directly under this title already says how many coupons, so
 * appending to the full name said coupon twice. Every other divisible drop is an Eternal piece,
 * whose name carries no such suffix, so this takes that one word off the end and nothing else.
 */
export function splitTitle(dropName: string): string {
  return `${dropName.replace(/ Coupon$/, "")} Config`;
}
