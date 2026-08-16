export interface IntentCheckResult {
  isValidClaim: boolean;
  message?: string;
}

const PLAYFUL_REJECTIONS = [
  "Bro 😭 what are we verifying here?",
  "Gng... this doesn't need the RAG treatment.",
  "No Pinecone required for this one. Give me a news claim.",
  "This is VNews Lab, not ChatGPT. Hit me with a real headline.",
  "I'm an investigation lab, not a casual chat bot. What claim are we verifying?",
];

const AMBIGUOUS_RESPONSES = [
  "That's a bit vague. Can you give me the specific claim or headline?",
  "I need more to go on. What exactly did they announce?",
  "Which specific part of that should I verify?",
];

export function checkQueryIntent(
  query: string
): IntentCheckResult {
  const lowerQuery = query.toLowerCase().trim();

  if (!lowerQuery) {
    return {
      isValidClaim: false,
      message: "Give me a claim to verify.",
    };
  }

  // Obvious non-verification inputs.
  if (
    lowerQuery.startsWith("what is my name") ||
    lowerQuery.startsWith("who are you") ||
    lowerQuery.startsWith("tell me a joke") ||
    lowerQuery.startsWith("write me a poem") ||
    lowerQuery.startsWith("write a poem") ||
    lowerQuery.startsWith("how are you")
  ) {
    return {
      isValidClaim: false,
      message:
        PLAYFUL_REJECTIONS[
        Math.floor(
          Math.random() * PLAYFUL_REJECTIONS.length
        )
        ],
    };
  }

  // Very short/vague inputs.
  if (lowerQuery.length < 12) {
    return {
      isValidClaim: false,
      message:
        AMBIGUOUS_RESPONSES[
        Math.floor(
          Math.random() * AMBIGUOUS_RESPONSES.length
        )
        ],
    };
  }

  // Let the actual verification engine handle factual claims.
  return {
    isValidClaim: true,
  };
}