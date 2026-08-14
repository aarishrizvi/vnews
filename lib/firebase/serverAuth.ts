// Simple server-side token verification using Firebase REST API
// This avoids needing a full Service Account JSON in the environment.

export async function verifyIdToken(idToken: string) {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is not set.");
  }

  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken })
  });

  if (!res.ok) {
    throw new Error("Invalid or expired ID token.");
  }

  const data = await res.json();
  if (!data.users || data.users.length === 0) {
    throw new Error("User not found.");
  }

  return data.users[0]; // Contains email, localId (uid), etc.
}

export async function requireAdmin(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error("Unauthorized");
  }

  const token = authHeader.split('Bearer ')[1];
  const user = await verifyIdToken(token);

  const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL;
  if (!adminEmail) {
    throw new Error("Admin email is not configured on the server.");
  }

  if (user.email !== adminEmail) {
    throw new Error("Forbidden: User is not an administrator.");
  }

  return user;
}
