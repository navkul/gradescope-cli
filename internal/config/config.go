package config

import (
	"os"
	"path/filepath"
)

const (
	DefaultBaseURL     = "https://www.gradescope.com"
	SessionFileName    = "session.json"
	DebugDirectoryName = "debug"
)

func AppConfigDir() (string, error) {
	root, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}

	return filepath.Join(root, "gradescope-cli"), nil
}

func DefaultSessionPath() (string, error) {
	root, err := AppConfigDir()
	if err != nil {
		return "", err
	}

	return filepath.Join(root, SessionFileName), nil
}

func DefaultDebugDir() (string, error) {
	root, err := AppConfigDir()
	if err != nil {
		return "", err
	}

	return filepath.Join(root, DebugDirectoryName), nil
}
