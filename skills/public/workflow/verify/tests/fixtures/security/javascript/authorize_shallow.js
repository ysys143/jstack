function authorize(role) {
  return role === "guest" ? "DENIED" : "ALLOWED";
}

process.stdout.write(authorize(process.argv[2]) + "\n");
