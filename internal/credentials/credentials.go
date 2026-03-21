package credentials

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
)

type Credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (c Credentials) Validate() error {
	if strings.TrimSpace(c.Email) == "" {
		return errors.New("missing email")
	}
	if strings.TrimSpace(c.Password) == "" {
		return errors.New("missing password")
	}

	return nil
}

func Load(email, password, passwordFile, credentialsFile string) (Credentials, error) {
	if credentialsFile != "" {
		creds, err := LoadFile(credentialsFile)
		if err != nil {
			return Credentials{}, err
		}
		return creds, creds.Validate()
	}

	if passwordFile != "" {
		content, err := os.ReadFile(passwordFile)
		if err != nil {
			return Credentials{}, fmt.Errorf("read password file: %w", err)
		}
		password = strings.TrimSpace(string(content))
	}

	if email == "" {
		email = os.Getenv("GRADESCOPE_EMAIL")
	}
	if password == "" {
		password = os.Getenv("GRADESCOPE_PASSWORD")
	}

	creds := Credentials{
		Email:    strings.TrimSpace(email),
		Password: strings.TrimSpace(password),
	}

	return creds, creds.Validate()
}

func LoadFile(path string) (Credentials, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return Credentials{}, fmt.Errorf("read credentials file: %w", err)
	}

	var creds Credentials
	if err := json.Unmarshal(content, &creds); err == nil {
		return creds, nil
	}

	for _, line := range strings.Split(string(content), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}

		key := strings.TrimSpace(parts[0])
		value := strings.Trim(strings.TrimSpace(parts[1]), `"'`)

		switch key {
		case "GRADESCOPE_EMAIL", "email":
			creds.Email = value
		case "GRADESCOPE_PASSWORD", "password":
			creds.Password = value
		}
	}

	if err := creds.Validate(); err != nil {
		return Credentials{}, fmt.Errorf("parse credentials file: %w", err)
	}

	return creds, nil
}
