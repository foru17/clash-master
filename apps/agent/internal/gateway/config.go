package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"

	"github.com/foru17/neko-master/apps/agent/internal/domain"
)

func (c *Client) GetConfigSnapshot(ctx context.Context) (*domain.GatewayConfigSnapshot, error) {
	switch c.gatewayType {
	case "clash":
		return c.getClashConfig(ctx)
	case "surge":
		return c.getSurgeConfig(ctx)
	case "passwall":
		return c.getPasswallConfig(ctx)
	default:
		return nil, fmt.Errorf("unsupported gateway type: %s", c.gatewayType)
	}
}

func (c *Client) getJSON(ctx context.Context, path string, out interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.endpoint+path, nil)
	if err != nil {
		return err
	}
	if c.token != "" {
		if c.gatewayType == "surge" {
			req.Header.Set("X-Key", c.token)
		} else {
			req.Header.Set("Authorization", "Bearer "+c.token)
		}
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("gateway %s returned %d: %s", path, resp.StatusCode, string(msg))
	}

	return json.NewDecoder(resp.Body).Decode(out)
}

func (c *Client) getClashConfig(ctx context.Context) (*domain.GatewayConfigSnapshot, error) {
	var rulesData struct {
		Rules []struct {
			Type    string `json:"type"`
			Payload string `json:"payload"`
			Proxy   string `json:"proxy"`
		} `json:"rules"`
	}
	if err := c.getJSON(ctx, "/rules", &rulesData); err != nil {
		return nil, fmt.Errorf("clash /rules error: %w", err)
	}

	var proxiesData struct {
		Proxies map[string]struct {
			Name string `json:"name"`
			Type string `json:"type"`
			Now  string `json:"now"`
		} `json:"proxies"`
	}
	if err := c.getJSON(ctx, "/proxies", &proxiesData); err != nil {
		return nil, fmt.Errorf("clash /proxies error: %w", err)
	}

	var providersData struct {
		Providers map[string]struct {
			Name    string `json:"name"`
			Type    string `json:"type"`
			Proxies []struct {
				Name string `json:"name"`
				Type string `json:"type"`
				Now  string `json:"now"`
			} `json:"proxies"`
		} `json:"providers"`
	}
	if err := c.getJSON(ctx, "/providers/proxies", &providersData); err != nil {
		fmt.Printf("[agent] warning: /providers/proxies not available: %v\n", err)
	}

	snap := &domain.GatewayConfigSnapshot{
		Rules:     make([]domain.GatewayRule, len(rulesData.Rules)),
		Proxies:   make(map[string]domain.GatewayProxy),
		Providers: make(map[string]domain.GatewayProvider),
	}

	for i, r := range rulesData.Rules {
		snap.Rules[i] = domain.GatewayRule{
			Type:    r.Type,
			Payload: r.Payload,
			Proxy:   r.Proxy,
		}
	}

	for k, p := range proxiesData.Proxies {
		snap.Proxies[k] = domain.GatewayProxy{
			Name: p.Name,
			Type: p.Type,
			Now:  p.Now,
		}
	}

	for k, v := range providersData.Providers {
		proxies := make([]domain.GatewayProxy, len(v.Proxies))
		for i, p := range v.Proxies {
			proxies[i] = domain.GatewayProxy{
				Name: p.Name,
				Type: p.Type,
				Now:  p.Now,
			}
		}
		snap.Providers[k] = domain.GatewayProvider{
			Name:    v.Name,
			Type:    v.Type,
			Proxies: proxies,
		}
	}

	return snap, nil
}

// GetPolicyStateSnapshot returns only the dynamic policy selection state (now field)
// This is much lighter than GetConfigSnapshot as it doesn't fetch rules
func (c *Client) GetPolicyStateSnapshot(ctx context.Context) (*domain.PolicyStateSnapshot, error) {
	switch c.gatewayType {
	case "clash":
		return c.getClashPolicyState(ctx)
	case "surge":
		return c.getSurgePolicyState(ctx)
	case "passwall":
		return c.getPasswallPolicyState(ctx)
	default:
		return nil, fmt.Errorf("unsupported gateway type: %s", c.gatewayType)
	}
}

func (c *Client) getSurgePolicyState(ctx context.Context) (*domain.PolicyStateSnapshot, error) {
	var policiesData struct {
		PolicyGroups []string `json:"policy-groups"`
		Proxies      []string `json:"proxies"`
	}
	if err := c.getJSON(ctx, "/v1/policies", &policiesData); err != nil {
		return nil, fmt.Errorf("surge /v1/policies error: %w", err)
	}

	snap := &domain.PolicyStateSnapshot{
		Proxies:   make(map[string]domain.GatewayProxy),
		Providers: make(map[string]domain.GatewayProvider),
	}

	// Add standalone proxies (no 'now' field for these)
	for _, p := range policiesData.Proxies {
		snap.Proxies[p] = domain.GatewayProxy{
			Name: p,
			Type: "Proxy",
		}
	}

	// Build provider proxies slice for policy groups
	providerProxies := make([]domain.GatewayProxy, 0, len(policiesData.PolicyGroups))

	// Fetch current selection for each policy group
	// Surge uses /v1/policy_groups/select?group_name=xxx endpoint
	for _, g := range policiesData.PolicyGroups {
		var groupDetail struct {
			Type   string `json:"type"`
			Policy string `json:"policy"`
		}
		query := url.Values{}
		query.Set("group_name", g)
		if err := c.getJSON(ctx, "/v1/policy_groups/select?"+query.Encode(), &groupDetail); err != nil {
			fmt.Printf("[agent] warning: failed to get policy detail for %s: %v\n", g, err)
		}
		snap.Proxies[g] = domain.GatewayProxy{
			Name: g,
			Type: groupDetail.Type,
			Now:  groupDetail.Policy,
		}
		providerProxies = append(providerProxies, domain.GatewayProxy{
			Name: g,
			Type: groupDetail.Type,
			Now:  groupDetail.Policy,
		})
	}

	// Create default provider
	if len(providerProxies) > 0 {
		snap.Providers["default"] = domain.GatewayProvider{
			Name:    "default",
			Type:    "SurgePolicyGroups",
			Proxies: providerProxies,
		}
	}

	return snap, nil
}

func (c *Client) getClashPolicyState(ctx context.Context) (*domain.PolicyStateSnapshot, error) {
	var proxiesData struct {
		Proxies map[string]struct {
			Name string `json:"name"`
			Type string `json:"type"`
			Now  string `json:"now"`
		} `json:"proxies"`
	}
	if err := c.getJSON(ctx, "/proxies", &proxiesData); err != nil {
		return nil, fmt.Errorf("clash /proxies error: %w", err)
	}

	snap := &domain.PolicyStateSnapshot{
		Proxies:   make(map[string]domain.GatewayProxy),
		Providers: make(map[string]domain.GatewayProvider),
	}

	// Group proxies by type for provider structure
	providerProxies := make(map[string][]domain.GatewayProxy)

	for name, p := range proxiesData.Proxies {
		proxy := domain.GatewayProxy{
			Name: p.Name,
			Type: p.Type,
			Now:  p.Now,
		}
		snap.Proxies[name] = proxy

		// Group by type for providers
		providerProxies[p.Type] = append(providerProxies[p.Type], proxy)
	}

	// Create providers by type. Sort the proxy slice for stable JSON
	// marshalling so the runner's md5 dedup actually catches no-op syncs —
	// upstream proxiesData is a map (random iteration order) without this.
	for typ, proxies := range providerProxies {
		sort.Slice(proxies, func(i, j int) bool { return proxies[i].Name < proxies[j].Name })
		snap.Providers[typ] = domain.GatewayProvider{
			Name:    typ,
			Type:    typ,
			Proxies: proxies,
		}
	}

	return snap, nil
}

func parseSurgeRuleForAgent(raw string) domain.GatewayRule {
	// For agent mode Surge, the master parses the raw rule text from the cache.
	return domain.GatewayRule{
		Raw: raw,
	}
}

func (c *Client) getSurgeConfig(ctx context.Context) (*domain.GatewayConfigSnapshot, error) {
	var rulesData struct {
		Rules []string `json:"rules"`
	}
	if err := c.getJSON(ctx, "/v1/rules", &rulesData); err != nil {
		return nil, fmt.Errorf("surge /v1/rules error: %w", err)
	}

	var policiesData struct {
		PolicyGroups []string `json:"policy-groups"`
		Proxies      []string `json:"proxies"`
	}
	if err := c.getJSON(ctx, "/v1/policies", &policiesData); err != nil {
		return nil, fmt.Errorf("surge /v1/policies error: %w", err)
	}

	snap := &domain.GatewayConfigSnapshot{
		Rules:     make([]domain.GatewayRule, len(rulesData.Rules)),
		Proxies:   make(map[string]domain.GatewayProxy),
		Providers: make(map[string]domain.GatewayProvider),
	}

	for i, raw := range rulesData.Rules {
		snap.Rules[i] = parseSurgeRuleForAgent(raw)
	}

	for _, p := range policiesData.Proxies {
		snap.Proxies[p] = domain.GatewayProxy{
			Name: p,
			Type: "Proxy",
		}
	}

	// Build provider proxies slice for policy groups
	providerProxies := make([]domain.GatewayProxy, 0, len(policiesData.PolicyGroups))

	// Fetch current selection for each policy group
	// Surge uses /v1/policy_groups/select?group_name=xxx endpoint
	for _, g := range policiesData.PolicyGroups {
		var groupDetail struct {
			Type   string `json:"type"`
			Policy string `json:"policy"`
		}
		query := url.Values{}
		query.Set("group_name", g)
		if err := c.getJSON(ctx, "/v1/policy_groups/select?"+query.Encode(), &groupDetail); err != nil {
			fmt.Printf("[agent] warning: failed to get policy detail for %s: %v\n", g, err)
		}
		snap.Proxies[g] = domain.GatewayProxy{
			Name: g,
			Type: groupDetail.Type,
			Now:  groupDetail.Policy,
		}
		// Also add to provider proxies for frontend compatibility
		providerProxies = append(providerProxies, domain.GatewayProxy{
			Name: g,
			Type: groupDetail.Type,
			Now:  groupDetail.Policy,
		})
	}

	// Create a default provider containing all policy groups
	// This ensures frontend's buildGroupNowMap can find the 'now' values
	if len(providerProxies) > 0 {
		snap.Providers["default"] = domain.GatewayProvider{
			Name:    "default",
			Type:    "SurgePolicyGroups",
			Proxies: providerProxies,
		}
	}

	return snap, nil
}

func (c *Client) getPasswallConfig(ctx context.Context) (*domain.GatewayConfigSnapshot, error) {
	if err := ensurePasswallOne(); err != nil {
		return nil, err
	}

	currentNode := getPasswallCurrentNode(ctx)
	snap := &domain.GatewayConfigSnapshot{
		Rules: []domain.GatewayRule{
			{
				Type:    "MATCH",
				Payload: "*",
				Proxy:   currentNode,
				Raw:     "MATCH,*,PassWall",
			},
		},
		Proxies: map[string]domain.GatewayProxy{
			currentNode: {
				Name: currentNode,
				Type: "PassWall",
				Now:  currentNode,
			},
			"DIRECT": {
				Name: "DIRECT",
				Type: "Direct",
			},
		},
		Providers: map[string]domain.GatewayProvider{
			"passwall": {
				Name: "passwall",
				Type: "PassWall",
				Proxies: []domain.GatewayProxy{
					{
						Name: currentNode,
						Type: "PassWall",
						Now:  currentNode,
					},
				},
			},
		},
	}

	return snap, nil
}

func (c *Client) getPasswallPolicyState(ctx context.Context) (*domain.PolicyStateSnapshot, error) {
	if err := ensurePasswallOne(); err != nil {
		return nil, err
	}

	currentNode := getPasswallCurrentNode(ctx)
	return &domain.PolicyStateSnapshot{
		Proxies: map[string]domain.GatewayProxy{
			currentNode: {
				Name: currentNode,
				Type: "PassWall",
				Now:  currentNode,
			},
		},
		Providers: map[string]domain.GatewayProvider{
			"passwall": {
				Name: "passwall",
				Type: "PassWall",
				Proxies: []domain.GatewayProxy{
					{
						Name: currentNode,
						Type: "PassWall",
						Now:  currentNode,
					},
				},
			},
		},
	}, nil
}
