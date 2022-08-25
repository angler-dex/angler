#!/bin/bash

kubectl delete all --all

kubectl cordon $(hostname)

kubectl drain $(hostname) \
  --delete-emptydir-data \
  --force --ignore-daemonsets

kubectl delete node $(hostname)

echo "stopping cluster..."
echo -e "y\n" | sudo kubeadm reset
sudo systemctl stop kubelet.service
sudo systemctl disable kubelet.service
sudo rm -rf /etc/kubernetes
sudo rm -rf /var/lib/kubelet/*
sudo rm -rf ~/.kube

sudo rm -rf /var/lib/cni/
sudo rm -rf /etc/cni/
sudo ip link set cni0 down
sudo ip link set flannel.1 down
sudo ip link delete cni0
sudo ip link delete flannel.1

# Below may break remote connections to machine
#echo "reseting ip tables"
#sudo iptables -F
#sudo iptables -t nat -F
#sudo iptables -t mangle -F
#sudo iptables -X

sudo kill -9 $(pgrep kube-apis) &>/dev/null || echo "kube-apis not running"

# Below will remove the angler operator container
#echo "clean up containerd"
#sudo ctr -n k8s.io i rm $(sudo ctr -n k8s.io i ls -q)
#sudo ctr -n k8s.io c rm $(sudo ctr -n k8s.io c ls -q)

echo "clean up docker"
echo "y" | sudo docker system prune
echo "y" | sudo docker volume prune

