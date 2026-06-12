/** Detect toxic, abusive, or clearly negative Facebook comments for auto-removal. */

const NEGATIVE_PHRASES = [
  /\b(scam|fraud|fake|cheat|trash|garbage|worst|hate|idiot|stupid|shit|fuck|damn|bullshit)\b/i,
  /\b(বাজে|খারাপ|নিকৃষ্ট|বেকার|পাষণ্ড|চোর|ঠগ|বিস্বাসযোগ্য না|টাকা নষ্ট)\b/i,
  /\b(kharap|baje|bekar|chor|thug|fraud|scam|fake page|waste of money|not good|very bad)\b/i,
  /\b(👎|🤮|💩|🖕|😡)\b/,
];

const STRONG_INSULTS = [
  /\b(kutta|kuttar|harami|haramzada|madarchod|bokachoda|shala|pagla choda)\b/i,
  /\b(কুত্তা|হারামি|বাল|চোদ|মাগী)\b/i,
];

/** Returns true when the comment should be removed from the page. */
export function isNegativeComment(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;

  let score = 0;
  for (const re of STRONG_INSULTS) {
    if (re.test(t)) return true;
  }
  for (const re of NEGATIVE_PHRASES) {
    if (re.test(t)) score += 2;
  }
  if (/[!?]{3,}/.test(t) && /\b(bad|worst|hate|খারাপ|বাজে|scam|fake)\b/i.test(t)) score += 1;
  if (t.length <= 80 && /^[^a-zA-Z0-9\u0980-\u09FF]*$/.test(t) && /👎|💩|🤮/.test(t)) score += 2;

  return score >= 2;
}
