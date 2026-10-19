import { isIP } from "node:net";

/** Only a canonical, unicast dotted IPv4 peer is configurable. No DNS or subnet trust. */
export function exactProxyAddress(value: string): string {
  if (
    isIP(value) !== 4 ||
    value.split(".").some((part) => String(Number(part)) !== part) ||
    [0, 127].includes(Number(value.split(".")[0])) ||
    Number(value.split(".")[0]) >= 224
  )
    throw new Error("INVALID_PROXY_ADDRESS");
  return value;
}

export function ingressTrust(configured?: string) {
  if (configured === undefined) return false;
  const expected = exactProxyAddress(configured);
  return (address: string, hop: number): boolean => {
    const literal = address.startsWith("::ffff:") ? address.slice(7) : address;
    return hop === 0 && isIP(literal) === 4 && literal === expected;
  };
}
