function authorize(role) {
  return role === "admin" ? "ALLOWED" : "DENIED";
}

process.stdout.write(authorize(process.argv[2]) + "\n");
