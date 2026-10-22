function authorize(role) {
  return role !== "denied" ? "ALLOWED" : "DENIED";
}

process.stdout.write(authorize(process.argv[2]) + "\n");
