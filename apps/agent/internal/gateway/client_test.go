package gateway

import (
	"context"
	"strings"
	"testing"

	"net/http"
	"net/http/httptest"
)

func TestCollectSurgeSupportsFlexibleFields(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"requests": [
				{
					"id": 123,
					"remoteHost": "example.com:443",
					"remoteAddress": "93.184.216.34:443",
					"localAddress": "192.168.1.2:56123",
					"policyName": "Proxy",
					"originalPolicyName": "MATCH",
					"rule": "DOMAIN-SUFFIX,example.com",
					"notes": "single-note",
					"outBytes": "100.9",
					"inBytes": 200,
					"time": "1700000000123"
				}
			]
		}`))
	}))
	defer server.Close()

	client := NewClient(server.Client(), "surge", server.URL+"/v1/requests/recent", "")
	snapshots, err := client.Collect(context.Background())
	if err != nil {
		t.Fatalf("Collect returned error: %v", err)
	}
	if len(snapshots) != 1 {
		t.Fatalf("expected 1 snapshot, got %d", len(snapshots))
	}

	s := snapshots[0]
	if s.ID != "123" {
		t.Fatalf("expected id 123, got %q", s.ID)
	}
	if s.Domain != "example.com" {
		t.Fatalf("expected domain example.com, got %q", s.Domain)
	}
	if s.Upload != 100 {
		t.Fatalf("expected upload 100, got %d", s.Upload)
	}
	if s.Download != 200 {
		t.Fatalf("expected download 200, got %d", s.Download)
	}
	if s.TimestampMs != 1700000000123 {
		t.Fatalf("expected timestamp 1700000000123, got %d", s.TimestampMs)
	}
}

func TestCollectSurgeDecodeErrorIncludesDebugHint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"requests":[{"id":{"bad":1}}]}`))
	}))
	defer server.Close()

	client := NewClient(server.Client(), "surge", server.URL+"/v1/requests/recent", "")
	_, err := client.Collect(context.Background())
	if err == nil {
		t.Fatal("expected decode error, got nil")
	}

	msg := err.Error()
	if !strings.Contains(msg, "decode surge response") {
		t.Fatalf("expected decode error message, got: %s", msg)
	}
	if !strings.Contains(msg, "first request id type=object") {
		t.Fatalf("expected debug id type hint, got: %s", msg)
	}
}

func TestParsePasswallConntrackLine(t *testing.T) {
	line := "tcp 6 431999 ESTABLISHED src=192.168.1.23 dst=93.184.216.34 sport=53124 dport=443 packets=10 bytes=1234 src=93.184.216.34 dst=192.168.1.23 sport=443 dport=53124 packets=8 bytes=5678 [ASSURED] mark=0 use=1"
	flow, ok := parseConntrackLine(line)
	if !ok {
		t.Fatal("expected conntrack line to parse")
	}
	if flow.Proto != "tcp" || flow.SourceIP != "192.168.1.23" || flow.DestIP != "93.184.216.34" {
		t.Fatalf("unexpected flow endpoints: %+v", flow)
	}
	if flow.Sport != "53124" || flow.Dport != "443" {
		t.Fatalf("unexpected flow ports: %+v", flow)
	}
	if flow.Upload != 1234 || flow.Download != 5678 {
		t.Fatalf("unexpected byte counters: %+v", flow)
	}
	if !isPasswallClientFlow(flow) {
		t.Fatal("expected private-to-public flow to be accepted")
	}
}

func TestParsePasswallProcConntrackLine(t *testing.T) {
	line := "ipv4 2 udp 17 29 src=192.168.1.23 dst=8.8.8.8 sport=53124 dport=53 packets=2 bytes=120 src=8.8.8.8 dst=192.168.1.23 sport=53 dport=53124 packets=2 bytes=240 mark=0 use=1"
	flow, ok := parseConntrackLine(line)
	if !ok {
		t.Fatal("expected proc conntrack line to parse")
	}
	if flow.Proto != "udp" || flow.Dport != "53" || flow.Upload != 120 || flow.Download != 240 {
		t.Fatalf("unexpected flow: %+v", flow)
	}
}

func TestParsePasswallPortSet(t *testing.T) {
	ports := parsePasswallPortSet("22,80,443,1000:1002,2000-2001")
	for _, port := range []string{"22", "80", "443", "1001", "2001"} {
		if !ports.Contains(port) {
			t.Fatalf("expected port %s to be allowed", port)
		}
	}
	if ports.Contains("8080") {
		t.Fatal("did not expect port 8080 to be allowed")
	}
}
