// tdh-tunnel (company-wg-desk-v1): this Mac's end of the company tunnel (the Qingdao hub, company-wg-hub-v1).
//
// The user, 2026-11-25: 「任何客户端都不要弹出这个窗口，默认连接新买的服务器」 — no Tailscale; the desk reaches the
// company server (10.66.0.2) through the company's own WireGuard hub. This runs as root under launchd
// (com.tdharness.tunnel, installed once by mac-tunnel-install.sh) because only root may make a network interface.
//
//	tdh-tunnel run    --dir D   keep the tunnel up: the key in D (made once, private half never leaves D),
//	                            the hub from D/hub.json (written at install, root's), this device's address
//	                            from D/enroll/peer.json (written by the desk after sign-in; only the address is taken)
//	tdh-tunnel status --dir D   one line: up/down, interface, address, last handshake
//
// The desk can only say which address it was given; where the tunnel goes (hub key, endpoint) is root's. A wrong
// address gains nothing: the hub takes from each key only the address it gave that key.
package main

import (

	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"golang.org/x/crypto/curve25519"
	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/device"
	"golang.zx2c4.com/wireguard/tun"
)

const (
	netPrefix = "10.66.0.0/24"
	mtu       = 1280
	poll      = 5 * time.Second
)

type hub struct {
	PubKey   string `json:"pubkey"`
	Endpoint string `json:"endpoint"`
}

type peer struct {
	Address string `json:"address"`
}

func logf(format string, a ...any) {
	fmt.Fprintf(os.Stdout, time.Now().Format("2006-01-02 15:04:05 ")+format+"\n", a...)
}

func b64key(s string) ([]byte, error) {
	k, err := base64.StdEncoding.DecodeString(strings.TrimSpace(s))
	if err != nil || len(k) != 32 {
		return nil, errors.New("bad key")
	}
	return k, nil
}

// The private key, made once; public.key beside it for the desk to send (world-readable, it is public).
func ensureKey(dir string) ([]byte, error) {
	p := filepath.Join(dir, "private.key")
	if raw, err := os.ReadFile(p); err == nil {
		if k, err := b64key(string(raw)); err == nil {
			return k, writePub(dir, k)
		}
	}
	k := make([]byte, 32)
	if _, err := rand.Read(k); err != nil {
		return nil, err
	}
	k[0] &= 248
	k[31] = (k[31] & 127) | 64
	if err := os.WriteFile(p, []byte(base64.StdEncoding.EncodeToString(k)+"\n"), 0o600); err != nil {
		return nil, err
	}
	logf("KEY_MADE=1")
	return k, writePub(dir, k)
}

func writePub(dir string, priv []byte) error {
	pub, err := curve25519.X25519(priv, curve25519.Basepoint)
	if err != nil {
		return err
	}
	want := base64.StdEncoding.EncodeToString(pub) + "\n"
	p := filepath.Join(dir, "public.key")
	if old, err := os.ReadFile(p); err == nil && string(old) == want {
		return nil
	}
	return os.WriteFile(p, []byte(want), 0o644)
}

func readHub(dir string) (hub, error) {
	var h hub
	raw, err := os.ReadFile(filepath.Join(dir, "hub.json"))
	if err != nil {
		return h, err
	}
	if err := json.Unmarshal(raw, &h); err != nil {
		return h, err
	}
	if _, err := b64key(h.PubKey); err != nil {
		return h, errors.New("hub key")
	}
	if _, err := netip.ParseAddrPort(h.Endpoint); err != nil {
		return h, errors.New("hub endpoint")
	}
	return h, nil
}

// Only an address inside the company tunnel, one host, never the hub's or the server's.
func readAddress(dir string) (netip.Addr, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "enroll", "peer.json"))
	if err != nil {
		return netip.Addr{}, err
	}
	var p peer
	if err := json.Unmarshal(raw, &p); err != nil {
		return netip.Addr{}, err
	}
	pfx, err := netip.ParsePrefix(strings.TrimSpace(p.Address))
	if err != nil || pfx.Bits() != 32 {
		return netip.Addr{}, errors.New("address")
	}
	a := pfx.Addr()
	net := netip.MustParsePrefix(netPrefix)
	if !net.Contains(a) || a.As4()[3] < 3 || a.As4()[3] > 250 {
		return netip.Addr{}, errors.New("address range")
	}
	return a, nil
}

func run(args ...string) error {
	out, err := exec.Command(args[0], args[1:]...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %v %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}

func routeOK(name string) bool {
	out, err := exec.Command("/sbin/route", "-n", "get", "-inet", "10.66.0.2").CombinedOutput()
	return err == nil && strings.Contains(string(out), "interface: "+name)
}

func ipcConfig(priv []byte, h hub) string {
	hk, _ := b64key(h.PubKey)
	return "private_key=" + hex.EncodeToString(priv) + "\n" +
		"replace_peers=true\n" +
		"public_key=" + hex.EncodeToString(hk) + "\n" +
		"endpoint=" + h.Endpoint + "\n" +
		"persistent_keepalive_interval=25\n" +
		"replace_allowed_ips=true\n" +
		"allowed_ip=" + netPrefix + "\n"
}

func cmdRun(dir string) error {
	if err := os.MkdirAll(filepath.Join(dir, "enroll"), 0o755); err != nil {
		return err
	}
	priv, err := ensureKey(dir)
	if err != nil {
		return err
	}
	var h hub
	var addr netip.Addr
	for {
		h, err = readHub(dir)
		if err == nil {
			addr, err = readAddress(dir)
		}
		if err == nil {
			break
		}
		logf("WAITING=%v", err)
		time.Sleep(poll)
	}
	td, err := tun.CreateTUN("utun", mtu)
	if err != nil {
		return err
	}
	name, _ := td.Name()
	dev := device.NewDevice(td, conn.NewDefaultBind(), device.NewLogger(device.LogLevelError, "tdh-tunnel: "))
	if err := dev.IpcSet(ipcConfig(priv, h)); err != nil {
		return err
	}
	if err := dev.Up(); err != nil {
		return err
	}
	setAddr := func(a netip.Addr) error {
		if err := run("/sbin/ifconfig", name, "inet", a.String()+"/32", a.String(), "alias"); err != nil {
			return err
		}
		if err := run("/sbin/ifconfig", name, "up"); err != nil {
			return err
		}
		_ = run("/sbin/route", "-q", "-n", "delete", "-inet", netPrefix)
		return run("/sbin/route", "-q", "-n", "add", "-inet", netPrefix, "-interface", name)
	}
	if err := setAddr(addr); err != nil {
		return err
	}
	_ = os.WriteFile(filepath.Join(dir, "status.json"), []byte(fmt.Sprintf(`{"iface":%q,"address":%q,"up":%d}`+"\n", name, addr.String(), time.Now().Unix())), 0o644)
	logf("UP iface=%s address=%s hub=%s", name, addr, h.Endpoint)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
	tick := time.NewTicker(poll)
	defer tick.Stop()
	for {
		select {
		case <-stop:
			logf("STOP")
			dev.Close()
			return nil
		case <-dev.Wait():
			return errors.New("device closed")
		case <-tick.C:
			// A new address (the desk enrolled again) or a new hub (reinstalled): take it without a restart.
			if a, err := readAddress(dir); err == nil && a != addr {
				_ = run("/sbin/ifconfig", name, "inet", addr.String(), "-alias")
				if err := setAddr(a); err == nil {
					logf("ADDRESS=%s (was %s)", a, addr)
					addr = a
				}
			}
			if nh, err := readHub(dir); err == nil && nh != h {
				if err := dev.IpcSet(ipcConfig(priv, nh)); err == nil {
					logf("HUB=%s", nh.Endpoint)
					h = nh
				}
			}
			// A network change can drop the route (sleep, Wi-Fi, a VPN app): put it back.
			if !routeOK(name) {
				_ = run("/sbin/route", "-q", "-n", "add", "-inet", netPrefix, "-interface", name)
				logf("ROUTE_RESTORED")
			}
		}
	}
}

func cmdStatus(dir string) error {
	raw, err := os.ReadFile(filepath.Join(dir, "status.json"))
	if err != nil {
		fmt.Println("TUNNEL=down")
		return nil
	}
	var st struct {
		Iface   string `json:"iface"`
		Address string `json:"address"`
	}
	_ = json.Unmarshal(raw, &st)
	if st.Iface == "" || !routeOK(st.Iface) {
		fmt.Println("TUNNEL=down")
		return nil
	}
	fmt.Printf("TUNNEL=up\nTUNNEL_IFACE=%s\nTUNNEL_ADDRESS=%s\n", st.Iface, st.Address)
	return nil
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: tdh-tunnel run|status --dir D")
		os.Exit(2)
	}
	dir := "/Library/Application Support/TDHarness/tunnel"
	for i := 2; i+1 < len(os.Args); i++ {
		if os.Args[i] == "--dir" {
			dir = os.Args[i+1]
		}
	}
	var err error
	switch os.Args[1] {
	case "run":
		err = cmdRun(dir)
	case "status":
		err = cmdStatus(dir)
	default:
		err = errors.New("unknown command")
	}
	if err != nil {
		logf("ERROR=%v", err)
		os.Exit(1)
	}

}
