import { IntentClassification } from '../types';

export interface IntentCheckResult extends IntentClassification {
  isValidClaim: boolean;
}

const PLAYFUL_REJECTIONS = [
  "This is not a factual claim that VNews can verify.",
  "This is not a verifiable fact claim.",
  "Give me a real claim to verify, not a general question.",
  "VNews verifies factual claims, not casual conversation.",
];

const AMBIGUOUS_RESPONSES = [
  "That is too vague to verify as a factual claim.",
  "Please provide a specific factual claim or event to verify.",
  "I need a clearer factual statement to investigate.",
];

function normalizeClaim(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function inferSubject(claim: string): string | undefined {
  const cleaned = normalizeClaim(claim).replace(/[?!.]+$/, '');
  const match = cleaned.match(/^(?:is|are|was|were|did|does|do|has|have|will|could|would|should)?\s*(.+?)(?:\s+(?:is|are|was|were|did|does|do|has|have|will|can|could|should|would)\b|$)/i);
  const candidate = match?.[1]?.trim();
  if (!candidate) return undefined;

  const lowered = candidate.toLowerCase();
  if (lowered.includes('modi')) return 'Narendra Modi';
  if (lowered.includes('khamenei')) return 'Ali Khamenei';
  if (lowered.includes('ravish')) return 'Ravish Kumar';
  if (lowered.includes('cjp')) return 'Chief Justice of India';

  return candidate.replace(/^the\s+/i, '').replace(/\s+is\s*$/i, '').trim() || undefined;
}

export function checkQueryIntent(query: string): IntentCheckResult {
  const cleaned = normalizeClaim(query);
  const lowerQuery = cleaned.toLowerCase();

  if (!lowerQuery) {
    return {
      isValidClaim: false,
      verifiable: false,
      type: 'NOT_VERIFIABLE',
      claim: '',
      message: 'Give me a claim to verify.',
    };
  }

  if (
    lowerQuery.startsWith('what is my name') ||
    lowerQuery.startsWith('who are you') ||
    lowerQuery.startsWith('how are you') ||
    lowerQuery.startsWith('tell me a joke') ||
    lowerQuery.startsWith('write me a poem') ||
    lowerQuery.startsWith('write a poem') ||
    lowerQuery.startsWith('hi ') ||
    lowerQuery === 'hi' ||
    lowerQuery === 'hello'
  ) {
    return {
      isValidClaim: false,
      verifiable: false,
      type: 'NOT_VERIFIABLE',
      claim: cleaned,
      message: PLAYFUL_REJECTIONS[Math.floor(Math.random() * PLAYFUL_REJECTIONS.length)],
    };
  }

  if (lowerQuery.length < 12) {
    return {
      isValidClaim: false,
      verifiable: false,
      type: 'NOT_VERIFIABLE',
      claim: cleaned,
      message: AMBIGUOUS_RESPONSES[Math.floor(Math.random() * AMBIGUOUS_RESPONSES.length)],
    };
  }

  const subject = inferSubject(cleaned) || cleaned;
  let type: IntentCheckResult['type'] = 'CURRENT_STATUS';
  let event: string | null = null;
  let location: string | null = null;
  let temporalContext = 'current';

  if (/(?:is|was|are|were)\s+(?:dead|deceased|died|passed away)/i.test(cleaned) || /(?:died|dead|passed away|killed|murdered)/i.test(cleaned)) {
    type = 'DEATH';
    event = 'death';
    temporalContext = 'current';
  } else if (/(criticizing|accusing|alleging|blaming|condemning|protesting|complaining|railing against|targeting)/i.test(cleaned)) {
    type = 'POLITICAL_NEWS_CLAIM';
    event = 'political criticism';
    if (/jharkhand|delhi|india| parliament|court|cjp|modi/i.test(cleaned)) {
      location = /jharkhand/i.test(cleaned) ? 'Jharkhand' : /india/i.test(cleaned) ? 'India' : null;
    }
  } else if (/(is|are|was|were)\s+(?:the\s+)?(prime minister|chief minister|president|minister|leader|governor)/i.test(cleaned) || /(?:prime minister|president|government|minister)/i.test(cleaned)) {
    type = 'CURRENT_STATUS';
    event = null;
    temporalContext = 'current';
  } else if (/(arrested|resigned|announced|declared|elected|fired|released|appointed|died|attacked|protested|accused)/i.test(cleaned)) {
    type = 'EVENT_CLAIM';
    event = /arrested|resigned|announced|declared|elected|fired|released|appointed|died|attacked|protested|accused/.exec(cleaned)?.[0] || 'event';
  }

  if (/jharkhand/i.test(cleaned)) location = 'Jharkhand';
  if (/india/i.test(cleaned) && !location) location = 'India';

  return {
    isValidClaim: true,
    verifiable: true,
    type,
    claim: cleaned,
    subject,
    event,
    location,
    temporalContext,
  };
}