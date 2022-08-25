#include <iostream>

#include <agmpc_matcher.h>
#include <jlog.h>

#include <emp-agmpc/cmpc_config.h>

#include <libgen.h>         // dirname
#include <unistd.h>         // readlink
#include <linux/limits.h>   // PATH_MAX

using namespace emp;
using namespace std;

#define APP_DEBUG 0

static const string outputDir = "/tmp/";

int main(int argc, char** argv) {
  if (argc < 5 || argc > 7) {
    error("Usage: agmpc_matcher_auction <ipaddr filepath> <output filepath> <party index> <capacity> [bid] [ms_logging]\n");
  }
  std::string ipFilePath = string(argv[1]);
  std::string outputFilePath = string(argv[2]);

  auto start = clock_start();
  std::vector<IpPort> ip_list;

  std::ifstream infile(ipFilePath);
  std::vector<std::string> fileIP;
  std::vector<int> filePorts;
  int nP = 0;
  string ip, port;
  while (getline(infile,ip,':')) {
    getline(infile,port);
    ip_list.push_back({ip, atoi(port.c_str())});
    ++nP;
  }

  int party_index = atoi(argv[3]);
  if (party_index > nP) {
    cout << "party_index out of range\n";
    return 1;
  }

  int capacity = atoi(argv[4]);

  if (party_index > 1 && argc <= 5) {
    cout << "bob needs to supply input bid\n";
    return 1;
  }

  int bid=0, msLogger=0;
  if (argc >= 6) {
    bid = atoi(argv[5]);
    if (argc >= 7) {
      msLogger = atoi(argv[6]);
    }
  }

  auto res = agmpc_matcher(ip_list, party_index, capacity, bid);
  double t2 = time_from(start);

  ofstream outputfs;
  outputfs.open (outputFilePath, ios::trunc | ios::out);
  outputfs << to_string(res->WinningParty) << " " << to_string(res->WinningBid) << "\n";
  outputfs.flush();
  outputfs.close();

  MSG("SeNtInAl,3dbar,%s,%s,%d,%d,%.0f\n", __FUNCTION__, "e2e-mpc", nP, msLogger, t2);
  return 0;
}
