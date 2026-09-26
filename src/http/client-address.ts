import { BlockList, isIP } from 'node:net';

const normalize = (address: string): string => address.startsWith('::ffff:') && isIP(address.slice(7)) === 4
  ? address.slice(7) : address;

export const createClientAddressResolver = (cidrs: string) => {
  const trusted = new BlockList();
  for (const cidr of cidrs.split(',').map((entry) => entry.trim()).filter(Boolean)) {
    const [address = '', prefix, extra] = cidr.split('/');
    const version = isIP(address);
    const bits = prefix === undefined ? (version === 4 ? 32 : 128) : Number(prefix);
    if (!version || extra !== undefined || !Number.isInteger(bits) || bits < 0 || bits > (version === 4 ? 32 : 128))
      throw new Error(`Invalid TRUSTED_PROXY_CIDRS entry: ${cidr}`);
    trusted.addSubnet(address, bits, version === 4 ? 'ipv4' : 'ipv6');
  }
  const isTrusted = (address: string) => trusted.check(normalize(address), isIP(normalize(address)) === 4 ? 'ipv4' : 'ipv6');

  return (request: Request, peer: string | null): string => {
    let address = peer ? normalize(peer) : 'unknown';
    if (!isIP(address) || !isTrusted(address)) return address;
    const forwarded = request.headers.get('x-forwarded-for');
    if (!forwarded) return address;
    const chain = forwarded.split(',').map((value) => normalize(value.trim()));
    if (chain.some((value) => !isIP(value))) return address;
    for (const hop of chain.reverse()) {
      if (!isTrusted(address)) break;
      address = hop;
    }
    return address;
  };
};
