package session

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

type Cookie struct {
	Name     string    `json:"name"`
	Value    string    `json:"value"`
	Path     string    `json:"path"`
	Domain   string    `json:"domain"`
	Expires  time.Time `json:"expires,omitempty"`
	Secure   bool      `json:"secure"`
	HttpOnly bool      `json:"http_only"`
}

type PersistedSession struct {
	BaseURL   string    `json:"base_url"`
	SavedAt   time.Time `json:"saved_at"`
	UserEmail string    `json:"user_email,omitempty"`
	Cookies   []Cookie  `json:"cookies"`
}

func NewJar() (http.CookieJar, error) {
	return cookiejar.New(nil)
}

func Load(path string) (*PersistedSession, http.CookieJar, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}

	var stored PersistedSession
	if err := json.Unmarshal(content, &stored); err != nil {
		return nil, nil, fmt.Errorf("decode session file: %w", err)
	}

	jar, err := NewJar()
	if err != nil {
		return nil, nil, err
	}

	baseURL, err := url.Parse(stored.BaseURL)
	if err != nil {
		return nil, nil, fmt.Errorf("parse session base url: %w", err)
	}

	cookies := make([]*http.Cookie, 0, len(stored.Cookies))
	for _, cookie := range stored.Cookies {
		c := &http.Cookie{
			Name:     cookie.Name,
			Value:    cookie.Value,
			Path:     cookie.Path,
			Domain:   cookie.Domain,
			Expires:  cookie.Expires,
			Secure:   cookie.Secure,
			HttpOnly: cookie.HttpOnly,
		}
		cookies = append(cookies, c)
	}
	jar.SetCookies(baseURL, cookies)

	return &stored, jar, nil
}

func Save(path, baseURL, email string, jar http.CookieJar) error {
	parsedBaseURL, err := url.Parse(baseURL)
	if err != nil {
		return fmt.Errorf("parse base url: %w", err)
	}

	stored := PersistedSession{
		BaseURL:   baseURL,
		SavedAt:   time.Now().UTC(),
		UserEmail: email,
	}

	for _, cookie := range jar.Cookies(parsedBaseURL) {
		stored.Cookies = append(stored.Cookies, Cookie{
			Name:     cookie.Name,
			Value:    cookie.Value,
			Path:     cookie.Path,
			Domain:   cookie.Domain,
			Expires:  cookie.Expires,
			Secure:   cookie.Secure,
			HttpOnly: cookie.HttpOnly,
		})
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create session directory: %w", err)
	}

	content, err := json.MarshalIndent(stored, "", "  ")
	if err != nil {
		return fmt.Errorf("encode session file: %w", err)
	}

	if err := os.WriteFile(path, content, 0o600); err != nil {
		return fmt.Errorf("write session file: %w", err)
	}

	return nil
}
