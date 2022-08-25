#!/bin/bash
scriptpath="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Install dependencies
[ ! -z "$(command -v curl)" ] || sudo apt-get install -y curl
[ ! -z "$(command -v htpasswd)" ] || sudo apt-get install -y apache2-utils
[ ! -z "$(command -v docker)" ] || bash <(curl -fsSL https://get.docker.com)
if [ -z "$(command -v kubectl)" ]; then
    curl -s https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo apt-key add
    echo "deb http://apt.kubernetes.io/ kubernetes-xenial main" | sudo tee --append /etc/apt/sources.list.d/kubernetes.list &>/dev/null
    sudo apt update
    sudo apt install -qy --allow-downgrades kubelet kubeadm kubectl
    sudo systemctl enable docker.service
fi

print_info() {
  echo -e "\033[33m$1\033[0m"
}

print_info "turn swap off"
sudo swapoff -a

print_info "setup kernel parameters"
export node_sysctl="
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
net.bridge.bridge-nf-call-ip6tables=1
net.bridge.bridge-nf-call-iptables=1
net.ipv4.ip_forward=1
fs.inotify.max_user_instances = 256
fs.inotify.max_user_watches = 524288
"
echo "$node_sysctl" | sudo tee /etc/sysctl.conf
sudo sysctl --system

# Cluster already running, dont stop, just exit
if sudo kubeadm config view &>/dev/null; then
    exit
    #source $scriptpath/k8s_stop.sh
fi

print_info "setup containerd"
sudo containerd config default | sudo tee /etc/containerd/config.toml 1>/dev/null
sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
sudo systemctl restart containerd.service
sleep 5

sudo systemctl enable kubelet.service

print_info "start cluster..."
sudo kubeadm init \
  --pod-network-cidr=10.244.0.0/16

print_info "install fresh kube-config.."
mkdir -p $HOME/.kube
sudo mkdir -p $HOME/.kube
sudo cp -f /etc/kubernetes/admin.conf $HOME/.kube/config
# fix any kubectl caching issues and chown .kube/config
# https://github.com/kubernetes/kubernetes/issues/59356
# https://groups.google.com/forum/#!topic/kubernetes-users/J34nmEt1NTw
sudo chown $(id -u):$(id -g) -R $HOME/.kube

print_info "start flannel CNI..."
kubectl apply -f https://raw.githubusercontent.com/coreos/flannel/master/Documentation/kube-flannel.yml

print_info "waiting for CoreDNS to start"
kubectl rollout status --namespace kube-system deployment coredns

print_info "allow scheduling on leader node"
kubectl taint node $(hostname) node-role.kubernetes.io/control-plane:NoSchedule-

print_info "cluster nodes"
kubectl get nodes


