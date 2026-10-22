package main

import (
	"fmt"
	"os"
)

func accept(_ string) string { return "ALLOWED" }

func main() { fmt.Println(accept(os.Args[1])) }
