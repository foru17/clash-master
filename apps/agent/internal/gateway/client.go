package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/foru17/neko-master/apps/agent/internal/domain"
)

var (
	domainPattern   = regexp.MustCompile(`^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$`)
	policyPathRegex = regexp.MustCompile(`\[Rule\] Policy decision path: (.+)`)
)

type Client struct {
	httpClient  *http.Client
	gatewayType string
	endpoint    string
	token       string
}

func NewClient(httpClient *http.Client, gatewayType, endpoint, token string) *Client {
	return &Client{
		httpClient:  httpClient,
		gatewayType: gatewayType,
		endpoint:    endpoint,
		token:       token,
	}
}

func (c *Client) Collect(ctx context.Context) ([]domain.FlowSnapshot, error) {
	switch c.gatewayType {
	case "clash":
		return c.collectClash(ctx)
	case "surge":
		return c.collectSurge(ctx)
	case "passwall":
		return c.collectPasswall(ctx)
	default:
		return nil, fmt.Errorf("unsupported gateway type: %s", c.gatewayType)
	}
}

type clashConnectionsResponse struct {
	Connections []struct {
		ID          string   `json:"id"`
		Upload      float64  `json:"upload"`
		Download    float64  `json:"download"`
		Rule        string   `json:"rule"`
		RulePayload string   `json:"rulePayload"`
		Chains      []string `json:"chains"`
		Metadata    struct {
			Host          string `json:"host"`
			SniffHost     string `json:"sniffHost"`
			DestinationIP string `json:"destinationIP"`
			SourceIP      string `json:"sourceIP"`
		} `json:"metadata"`
	} `json:"connections"`
}

type flexibleID string

func (v *flexibleID) UnmarshalJSON(data []byte) error {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		*v = ""
		return nil
	}

	var strVal string
	if err := json.Unmarshal(trimmed, &strVal); err == nil {
		*v = flexibleID(strVal)
		return nil
	}

	var numVal json.Number
	if err := json.Unmarshal(trimmed, &numVal); err == nil {
		*v = flexibleID(numVal.String())
		return nil
	}

	return fmt.Errorf("unsupported id value: %s", string(trimmed))
}

type flexibleFloat64 float64

func (v *flexibleFloat64) UnmarshalJSON(data []byte) error {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		*v = 0
		return nil
	}

	var numVal json.Number
	if err := json.Unmarshal(trimmed, &numVal); err == nil {
		f, err := numVal.Float64()
		if err != nil {
			return fmt.Errorf("invalid numeric value: %s", string(trimmed))
		}
		*v = flexibleFloat64(f)
		return nil
	}

	var strVal string
	if err := json.Unmarshal(trimmed, &strVal); err == nil {
		strVal = strings.TrimSpace(strVal)
		if strVal == "" {
			*v = 0
			return nil
		}
		f, err := json.Number(strVal).Float64()
		if err != nil {
			return fmt.Errorf("invalid numeric string: %q", strVal)
		}
		*v = flexibleFloat64(f)
		return nil
	}

	return fmt.Errorf("unsupported numeric value: %s", string(trimmed))
}

type flexibleStringList []string

func (v *flexibleStringList) UnmarshalJSON(data []byte) error {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		*v = nil
		return nil
	}

	var list []string
	if err := json.Unmarshal(trimmed, &list); err == nil {
		*v = list
		return nil
	}

	var single string
	if err := json.Unmarshal(trimmed, &single); err == nil {
		single = strings.TrimSpace(single)
		if single == "" {
			*v = nil
			return nil
		}
		*v = []string{single}
		return nil
	}

	return fmt.Errorf("unsupported notes value: %s", string(trimmed))
}

type surgeRequestsResponse struct {
	Requests []struct {
		ID                 flexibleID         `json:"id"`
		RemoteHost         string             `json:"remoteHost"`
		RemoteAddress      string             `json:"remoteAddress"`
		LocalAddress       string             `json:"localAddress"`
		SourceAddress      string             `json:"sourceAddress"`
		PolicyName         string             `json:"policyName"`
		OriginalPolicyName string             `json:"originalPolicyName"`
		Rule               string             `json:"rule"`
		Notes              flexibleStringList `json:"notes"`
		OutBytes           flexibleFloat64    `json:"outBytes"`
		InBytes            flexibleFloat64    `json:"inBytes"`
		Time               flexibleFloat64    `json:"time"`
	} `json:"requests"`
}

type passwallConntrackFlow struct {
	Proto    string
	SourceIP string
	DestIP   string
	Sport    string
	Dport    string
	Upload   int64
	Download int64
}

func (c *Client) collectClash(ctx context.Context) ([]domain.FlowSnapshot, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.endpoint+"/connections", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("gateway http %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload clashConnectionsResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode clash response: %w", err)
	}

	nowMs := time.Now().UnixMilli()
	snapshots := make([]domain.FlowSnapshot, 0, len(payload.Connections))
	for _, item := range payload.Connections {
		id := strings.TrimSpace(item.ID)
		if id == "" {
			continue
		}
		domainName := strings.TrimSpace(item.Metadata.Host)
		if domainName == "" {
			domainName = strings.TrimSpace(item.Metadata.SniffHost)
		}
		snapshots = append(snapshots, domain.FlowSnapshot{
			ID:          id,
			Domain:      domainName,
			IP:          strings.TrimSpace(item.Metadata.DestinationIP),
			SourceIP:    strings.TrimSpace(item.Metadata.SourceIP),
			Chains:      normalizeChains(item.Chains),
			Rule:        defaultString(strings.TrimSpace(item.Rule), "Match"),
			RulePayload: strings.TrimSpace(item.RulePayload),
			Upload:      toInt64(item.Upload),
			Download:    toInt64(item.Download),
			TimestampMs: nowMs,
		})
	}

	return snapshots, nil
}

func (c *Client) collectSurge(ctx context.Context) ([]domain.FlowSnapshot, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.endpoint+"/v1/requests/recent", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if c.token != "" {
		req.Header.Set("x-key", c.token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("gateway http %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	if err != nil {
		return nil, fmt.Errorf("read surge response: %w", err)
	}

	var payload surgeRequestsResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("decode surge response: %w (debug: %s)", err, inspectSurgeDecodeError(body))
	}

	nowMs := time.Now().UnixMilli()
	snapshots := make([]domain.FlowSnapshot, 0, len(payload.Requests))
	for _, reqItem := range payload.Requests {
		id := strings.TrimSpace(string(reqItem.ID))
		if id == "" {
			continue
		}

		remoteHost := strings.TrimSpace(reqItem.RemoteHost)
		remoteAddress := strings.TrimSpace(strings.Split(remoteAddressFirst(reqItem.RemoteAddress), " ")[0])
		hostWithoutPort := extractHost(remoteHost)

		domainName := ""
		if isDomainName(remoteHost) {
			domainName = hostWithoutPort
		}
		ip := ""
		if isIPHost(remoteHost) {
			ip = hostWithoutPort
		} else if isIPHost(remoteAddress) {
			ip = extractHost(remoteAddress)
		}

		sourceIP := extractHost(defaultString(strings.TrimSpace(reqItem.LocalAddress), strings.TrimSpace(reqItem.SourceAddress)))
		chains := convertSurgeChains(reqItem.PolicyName, reqItem.OriginalPolicyName, []string(reqItem.Notes))
		rule := defaultString(strings.TrimSpace(lastChain(chains)), defaultString(strings.TrimSpace(reqItem.OriginalPolicyName), "Match"))
		rulePayload := strings.TrimSpace(reqItem.Rule)

		timestampMs := nowMs
		if reqItem.Time > 0 {
			timestampMs = toInt64(float64(reqItem.Time))
		}

		snapshots = append(snapshots, domain.FlowSnapshot{
			ID:          id,
			Domain:      domainName,
			IP:          ip,
			SourceIP:    sourceIP,
			Chains:      chains,
			Rule:        defaultString(rule, "Match"),
			RulePayload: rulePayload,
			Upload:      toInt64(float64(reqItem.OutBytes)),
			Download:    toInt64(float64(reqItem.InBytes)),
			TimestampMs: timestampMs,
		})
	}

	return snapshots, nil
}

func (c *Client) collectPasswall(ctx context.Context) ([]domain.FlowSnapshot, error) {
	if err := ensurePasswallOne(); err != nil {
		return nil, err
	}

	currentNode := getPasswallCurrentNode(ctx)
	allowedTCPPorts := parsePasswallPortSet(passwallUCIGet(ctx, "passwall.@global_forwarding[0].tcp_redir_ports", "22,25,53,143,465,587,853,993,995,80,443"))
	allowedUDPPorts := parsePasswallPortSet(passwallUCIGet(ctx, "passwall.@global_forwarding[0].udp_redir_ports", "1:65535"))

	lines, err := readConntrackLines(ctx)
	if err != nil {
		return nil, err
	}

	nowMs := time.Now().UnixMilli()
	snapshots := make([]domain.FlowSnapshot, 0, len(lines))
	for _, line := range lines {
		flow, ok := parseConntrackLine(line)
		if !ok || flow.Upload <= 0 && flow.Download <= 0 {
			continue
		}
		if !isPasswallClientFlow(flow) {
			continue
		}
		if flow.Proto == "tcp" && !allowedTCPPorts.Contains(flow.Dport) {
			continue
		}
		if flow.Proto == "udp" && !allowedUDPPorts.Contains(flow.Dport) {
			continue
		}

		snapshots = append(snapshots, domain.FlowSnapshot{
			ID:          strings.Join([]string{flow.Proto, flow.SourceIP, flow.Sport, flow.DestIP, flow.Dport}, ":"),
			IP:          flow.DestIP,
			SourceIP:    flow.SourceIP,
			Chains:      []string{currentNode},
			Rule:        "PassWall",
			RulePayload: strings.ToUpper(flow.Proto) + "/" + flow.Dport,
			Upload:      flow.Upload,
			Download:    flow.Download,
			TimestampMs: nowMs,
		})
	}

	return snapshots, nil
}

type passwallPortSet struct {
	allowAll bool
	ports    map[int]struct{}
	ranges   [][2]int
}

func (s passwallPortSet) Contains(port string) bool {
	if s.allowAll {
		return true
	}
	n, err := strconv.Atoi(strings.TrimSpace(port))
	if err != nil || n <= 0 || n > 65535 {
		return false
	}
	if _, ok := s.ports[n]; ok {
		return true
	}
	for _, r := range s.ranges {
		if n >= r[0] && n <= r[1] {
			return true
		}
	}
	return false
}

func parsePasswallPortSet(raw string) passwallPortSet {
	set := passwallPortSet{ports: make(map[int]struct{})}
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" || strings.EqualFold(part, "disable") {
			continue
		}
		if part == "1:65535" || part == "1-65535" || part == "0:65535" || part == "0-65535" {
			set.allowAll = true
			continue
		}
		if strings.ContainsAny(part, ":-") {
			sep := ":"
			if strings.Contains(part, "-") {
				sep = "-"
			}
			bounds := strings.SplitN(part, sep, 2)
			start, err1 := strconv.Atoi(strings.TrimSpace(bounds[0]))
			end, err2 := strconv.Atoi(strings.TrimSpace(bounds[1]))
			if err1 == nil && err2 == nil && start <= end && start > 0 && end <= 65535 {
				set.ranges = append(set.ranges, [2]int{start, end})
			}
			continue
		}
		port, err := strconv.Atoi(part)
		if err == nil && port > 0 && port <= 65535 {
			set.ports[port] = struct{}{}
		}
	}
	return set
}

func ensurePasswallOne() error {
	hasPasswall := fileExists("/etc/config/passwall")
	hasPasswall2 := fileExists("/etc/config/passwall2")
	if !hasPasswall && hasPasswall2 {
		return fmt.Errorf("passwall2 is installed, but gateway-type passwall only supports luci-app-passwall 25.8.5-1 / PassWall 1")
	}
	if !hasPasswall {
		return fmt.Errorf("passwall config not found at /etc/config/passwall")
	}
	return nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func getPasswallCurrentNode(ctx context.Context) string {
	nodeID := passwallUCIGet(ctx, "passwall.@global[0].tcp_node", "")
	if nodeID == "" || nodeID == "nil" || strings.HasPrefix(nodeID, "_") {
		nodeID = passwallUCIGet(ctx, "passwall.@global[0].udp_node", "")
	}
	if nodeID == "" || nodeID == "tcp" || strings.HasPrefix(nodeID, "_") {
		return "PassWall"
	}
	remarks := passwallUCIGet(ctx, "passwall."+nodeID+".remarks", "")
	return defaultString(remarks, nodeID)
}

func passwallUCIGet(ctx context.Context, key string, fallback string) string {
	out, err := exec.CommandContext(ctx, "uci", "-q", "get", key).Output()
	if err != nil {
		return fallback
	}
	value := strings.TrimSpace(string(out))
	if value == "" {
		return fallback
	}
	return value
}

func readConntrackLines(ctx context.Context) ([]string, error) {
	out, err := exec.CommandContext(ctx, "conntrack", "-L", "-o", "extended").CombinedOutput()
	if err == nil {
		return splitNonEmptyLines(string(out)), nil
	}
	data, readErr := os.ReadFile("/proc/net/nf_conntrack")
	if readErr == nil {
		return splitNonEmptyLines(string(data)), nil
	}
	data, readErr = os.ReadFile("/proc/net/ip_conntrack")
	if readErr == nil {
		return splitNonEmptyLines(string(data)), nil
	}
	return nil, fmt.Errorf("read conntrack failed: %v", err)
}

func splitNonEmptyLines(raw string) []string {
	rawLines := strings.Split(raw, "\n")
	lines := make([]string, 0, len(rawLines))
	for _, line := range rawLines {
		line = strings.TrimSpace(line)
		if line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

func parseConntrackLine(line string) (passwallConntrackFlow, bool) {
	fields := strings.Fields(line)
	if len(fields) < 8 {
		return passwallConntrackFlow{}, false
	}

	proto := strings.ToLower(fields[0])
	if (proto == "ipv4" || proto == "ipv6") && len(fields) >= 3 {
		proto = strings.ToLower(fields[2])
	}

	flow := passwallConntrackFlow{Proto: proto}
	if flow.Proto != "tcp" && flow.Proto != "udp" {
		return passwallConntrackFlow{}, false
	}

	var srcs, dsts, sports, dports []string
	var bytesValues []int64
	for _, field := range fields {
		key, value, ok := strings.Cut(field, "=")
		if !ok {
			continue
		}
		switch key {
		case "src":
			srcs = append(srcs, value)
		case "dst":
			dsts = append(dsts, value)
		case "sport":
			sports = append(sports, value)
		case "dport":
			dports = append(dports, value)
		case "bytes":
			n, err := strconv.ParseInt(value, 10, 64)
			if err == nil && n > 0 {
				bytesValues = append(bytesValues, n)
			}
		}
	}
	if len(srcs) == 0 || len(dsts) == 0 || len(sports) == 0 || len(dports) == 0 {
		return passwallConntrackFlow{}, false
	}

	flow.SourceIP = srcs[0]
	flow.DestIP = dsts[0]
	flow.Sport = sports[0]
	flow.Dport = dports[0]
	if len(bytesValues) > 0 {
		flow.Upload = bytesValues[0]
	}
	if len(bytesValues) > 1 {
		flow.Download = bytesValues[1]
	}
	return flow, true
}

func isPasswallClientFlow(flow passwallConntrackFlow) bool {
	src := net.ParseIP(flow.SourceIP)
	dst := net.ParseIP(flow.DestIP)
	if src == nil || dst == nil {
		return false
	}
	if !src.IsPrivate() {
		return false
	}
	if dst.IsPrivate() || dst.IsLoopback() || dst.IsMulticast() || dst.IsUnspecified() {
		return false
	}
	return true
}

func normalizeChains(chains []string) []string {
	if len(chains) == 0 {
		return []string{"DIRECT"}
	}
	out := make([]string, 0, len(chains))
	for _, chain := range chains {
		trimmed := strings.TrimSpace(chain)
		if trimmed == "" {
			continue
		}
		out = append(out, trimmed)
		if len(out) >= 12 {
			break
		}
	}
	if len(out) == 0 {
		return []string{"DIRECT"}
	}
	return out
}

func lastChain(chains []string) string {
	if len(chains) == 0 {
		return ""
	}
	return strings.TrimSpace(chains[len(chains)-1])
}

func toInt64(v float64) int64 {
	if v <= 0 {
		return 0
	}
	if v > float64(^uint64(0)>>1) {
		return int64(^uint64(0) >> 1)
	}
	return int64(v)
}

func defaultString(v string, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return strings.TrimSpace(v)
}

func remoteAddressFirst(v string) string {
	parts := strings.Split(v, ",")
	if len(parts) == 0 {
		return ""
	}
	return strings.TrimSpace(parts[0])
}

func extractHost(hostWithPort string) string {
	hostWithPort = strings.TrimSpace(hostWithPort)
	if hostWithPort == "" {
		return ""
	}

	if strings.HasPrefix(hostWithPort, "[") {
		closing := strings.Index(hostWithPort, "]")
		if closing > 1 {
			return hostWithPort[1:closing]
		}
	}

	host, _, err := net.SplitHostPort(hostWithPort)
	if err == nil {
		return host
	}

	return strings.TrimSpace(hostWithPort)
}

func isIPHost(host string) bool {
	h := extractHost(host)
	if h == "" {
		return false
	}
	ip := net.ParseIP(h)
	return ip != nil
}

func isDomainName(host string) bool {
	h := extractHost(host)
	if h == "" {
		return false
	}
	if isIPHost(h) {
		return false
	}
	return domainPattern.MatchString(h)
}

func convertSurgeChains(policyName string, originalPolicyName string, notes []string) []string {
	if fromNotes := extractPolicyPathFromNotes(notes); len(fromNotes) >= 2 {
		return fromNotes
	}

	chains := make([]string, 0, 2)
	if p := strings.TrimSpace(policyName); p != "" {
		chains = append(chains, p)
	}
	o := strings.TrimSpace(originalPolicyName)
	if o != "" && o != strings.TrimSpace(policyName) {
		chains = append(chains, o)
	}
	if len(chains) == 0 {
		return []string{"DIRECT"}
	}
	return chains
}

func extractPolicyPathFromNotes(notes []string) []string {
	if len(notes) == 0 {
		return nil
	}
	for _, note := range notes {
		m := policyPathRegex.FindStringSubmatch(note)
		if len(m) < 2 {
			continue
		}
		segments := strings.Split(m[1], " -> ")
		cleaned := make([]string, 0, len(segments))
		for _, segment := range segments {
			s := strings.TrimSpace(segment)
			if s != "" {
				cleaned = append(cleaned, s)
			}
		}
		if len(cleaned) >= 2 {
			for i, j := 0, len(cleaned)-1; i < j; i, j = i+1, j-1 {
				cleaned[i], cleaned[j] = cleaned[j], cleaned[i]
			}
			return cleaned
		}
	}
	return nil
}

func inspectSurgeDecodeError(body []byte) string {
	if len(body) == 0 {
		return "empty response body"
	}

	var root map[string]json.RawMessage
	if err := json.Unmarshal(body, &root); err != nil {
		return "invalid json: " + truncateForLog(string(bytes.TrimSpace(body)), 240)
	}

	rawRequests, ok := root["requests"]
	if !ok {
		keys := make([]string, 0, len(root))
		for k := range root {
			keys = append(keys, k)
		}
		return "missing requests field, available keys: " + strings.Join(keys, ",")
	}

	var requests []map[string]json.RawMessage
	if err := json.Unmarshal(rawRequests, &requests); err != nil {
		return "requests is not array: " + truncateForLog(string(bytes.TrimSpace(rawRequests)), 240)
	}
	if len(requests) == 0 {
		return "requests array is empty"
	}

	rawID, ok := requests[0]["id"]
	if !ok {
		keys := make([]string, 0, len(requests[0]))
		for k := range requests[0] {
			keys = append(keys, k)
		}
		return "first request missing id, available keys: " + strings.Join(keys, ",")
	}

	return "first request id type=" + detectJSONType(rawID) + " value=" + truncateForLog(string(bytes.TrimSpace(rawID)), 80)
}

func detectJSONType(raw json.RawMessage) string {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return "empty"
	}
	switch trimmed[0] {
	case '"':
		return "string"
	case '{':
		return "object"
	case '[':
		return "array"
	case 't', 'f':
		return "boolean"
	case 'n':
		return "null"
	default:
		if (trimmed[0] >= '0' && trimmed[0] <= '9') || trimmed[0] == '-' {
			return "number"
		}
		return "unknown"
	}
}

func truncateForLog(s string, limit int) string {
	s = strings.TrimSpace(s)
	if limit <= 0 || len(s) <= limit {
		return s
	}
	return s[:limit] + "..."
}
