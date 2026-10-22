package main

import (
	"fmt"
	"os"
	"strconv"
)

func accept(value string) string {
	n, err := strconv.Atoi(value)
	if err != nil || n < 0 || n > 10 {
		return "DENIED"
	}
	return "ALLOWED"
}

func main() { fmt.Println(accept(os.Args[1])) }
