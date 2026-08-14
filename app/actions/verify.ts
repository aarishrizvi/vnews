'use server';

import { checkQueryIntent } from '@/lib/services/intent';
import { redirect } from 'next/navigation';

export async function submitVerification(formData: FormData) {
  const query = formData.get('query') as string;
  if (!query) return { error: "Please enter a claim to verify." };

  // 1. Intent Check
  const intent = await checkQueryIntent(query);
  
  if (!intent.isValidClaim) {
    return {
      error: intent.message || "Invalid claim.",
      state: 'error'
    };
  }

  // 2. If valid, redirect to the results page to show processing and streaming
  // Create a temporary ID or search record ID. 
  // For now, encode the query to pass it. In a real app, save to DB first.
  const searchId = encodeURIComponent(query);
  
  redirect(`/results/search?q=${searchId}`);
}
