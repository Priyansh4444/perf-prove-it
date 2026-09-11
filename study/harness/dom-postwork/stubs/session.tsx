const USERS = [
  { _id: "u1", name: "maya", role: "member" },
  { _id: "u2", name: "otto", role: "admin" },
  { _id: "u3", name: "quill bot", role: "member" },
];

export function useSession() {
  return {
    currentUserId: "u1",
    currentUser: USERS[0],
    users: USERS,
  };
}
