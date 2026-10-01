import dns from "node:dns";
import net from "node:net";

// Cloudflare publishes AAAA records for tiendu.uy. WSL often cannot complete
// those IPv6 handshakes, and Node reports the failure as
// `fetch failed (ETIMEDOUT)` before any HTTP response — including API-key
// checks — is received.
//
// `dns.setDefaultResultOrder("ipv4first")` is not enough: undici still asks
// for every address with `verbatim: true` and then happy-eyeballs onto IPv6.
dns.setDefaultResultOrder("ipv4first");

if (typeof net.setDefaultAutoSelectFamily === "function") {
  net.setDefaultAutoSelectFamily(false);
}

/** @param {unknown} options */
const forceIPv4LookupOptions = (options) => {
  if (typeof options === "number") return 4;
  if (!options || typeof options !== "object") return { family: 4 };
  return { ...options, family: 4, verbatim: false };
};

const originalLookup = dns.lookup.bind(dns);
dns.lookup = (hostname, options, callback) => {
  if (typeof options === "function") {
    return originalLookup(hostname, { family: 4 }, options);
  }
  return originalLookup(hostname, forceIPv4LookupOptions(options), callback);
};

const originalPromisesLookup = dns.promises.lookup.bind(dns.promises);
dns.promises.lookup = (hostname, options) =>
  originalPromisesLookup(hostname, forceIPv4LookupOptions(options));
