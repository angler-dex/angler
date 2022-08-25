// including the plain protocol execution
#include <emp-tool/execution/plain_prot.h>

// browse the `circuits` subdirectory for different pre-written circuits.
#include <emp-tool/circuits/bit.h>
#include <emp-tool/circuits/circuit_file.h>

#include <iostream>

using namespace emp;
using namespace std;

typedef struct Resource {
    Integer capacity;
    Integer price;
} Resource;

int num_providers;
vector<Resource> db;
vector<vector<Integer>> lp_pts;

void prep_points(vector<Integer> &tup, int base_i, int last_i=-1, int depth=0) {
  if (depth >= 0) return;
  for (int i=last_i + 1; i<num_providers; ++i) {
    cout << "  trying base_i " << base_i << " i " << i << " last_i " << last_i << '\n';
    if (i != base_i) {
      auto tup_base_i_save = tup[base_i];
      auto tup_i_save = tup[i];
      tup[base_i] = tup[base_i] - db[i].capacity;
      tup[i] = tup[i] + db[i].capacity;
      lp_pts.push_back(tup);
      cout << "  pushed base_i " << base_i << " i " << i << " last_i " << last_i << '\n';
      prep_points(tup, base_i, i, depth+1);
      tup[base_i] = tup_base_i_save;
      tup[i] = tup_i_save;
    }
  }
}

int main(int argc, char** argv) {
    if (argc != 2)
        error("Usage: agmpc_circuit_generator <max num parties>\n");

    int max_num_parties = atoi (argv[1]);
    if (max_num_parties < 3)
        error("Requires at least 3 parties\n");

    for (int num_parties = 3; num_parties <= max_num_parties; ++num_parties) {
      std::string circuitDir = CIRCUIT_DIR;
      std::string circuitPath = circuitDir + "/agmpc_matcher_" + to_string(num_parties) + "_circuit.txt";

      emp::setup_plain_prot(true, circuitPath.c_str());

      // no public wires in agmpc, alice must supply
      Integer globalMinIndex(32, 0, ALICE);
      Integer globalMinCost(32, INT_MAX, ALICE);
      Integer curIndex(32, 2, ALICE); // 0=none, 1=alice, 2=first bob
      Integer one(32, 1, ALICE);
      Integer request_sz(32, 0, ALICE);
      //Integer zero(32, 0, ALICE);
      //Integer inf(32, 0, ALICE);

      num_providers = num_parties-1;

      for (int i=0; i < num_providers; i++) {
          Resource r = {
              Integer(32, 0, BOB), // capacity
              Integer(32, 0, BOB) // price
          };
          db.push_back(r);
      }

      //// Second price auction
      // 10pc -> 2016 AND gates
      //Integer globalMinIndex(32, 0, ALICE);
      //Integer globalMinCost(32, INT_MAX, ALICE);
      //Integer secondPrice(32, INT_MAX, ALICE);
      //Integer curIndex(32, 2, ALICE); // 0=none, 1=alice, 2=first bob
      //Integer one(32, 1, ALICE);
      //for (auto rec = db.begin(); rec != db.end(); rec++) {
      //    Bit isMin = rec->price < globalMinCost;
      //    secondPrice = secondPrice.If(isMin, globalMinCost);
      //    globalMinCost = globalMinCost.If(isMin, rec->price);
      //    globalMinIndex = globalMinIndex.If(isMin, curIndex);
      //    Bit isSecondMin = (!isMin) & (rec->price < secondPrice);
      //    secondPrice = secondPrice.If(isSecondMin, rec->price);
      //    curIndex = curIndex + one;
      //}
      //globalMinIndex.reveal<int>();
      //secondPrice.reveal<int>();


      //// First price auction checks capacity
      // 10pc -> 1440 AND gates
      for (int p=0; p < db.size(); ++p) {
        Bit is_under_capacity = request_sz < db[p].capacity;
        Bit is_min_price = db[p].price < globalMinCost;
        Bit best_choice = is_under_capacity & is_min_price;
        globalMinIndex = globalMinIndex.If(best_choice, curIndex);
        globalMinCost = globalMinCost.If(best_choice, db[p].price);
        curIndex = curIndex + one;
      }
      globalMinIndex.reveal<int>();
      globalMinCost.reveal<int>();


      //// First price auction for each unit in request
      //// can allocate on multiple providers
      //// 10pc -> 5148 AND gates
      //int max_num_resources = 2;
      //Integer one(32, 1, ALICE);
      //vector<Integer> allocs(num_providers, zero);
      //vector<Integer> costs(num_providers, zero);
      //for (int r=0; r < max_num_resources; ++r) {
      //  Integer min_cost = zero;
      //  Integer min_index = zero;
      //  for (int p=0; p < db.size(); ++p) {
      //    Integer cur_index(32, p, ALICE);
      //    Bit is_under_capacity = request_sz < db[p].capacity;
      //    Bit is_min_price = db[p].price < min_cost;
      //    Bit best_choice = is_under_capacity & is_min_price;
      //    min_cost = min_cost.If(best_choice, db[p].price);
      //    min_index = min_index.If(best_choice, cur_index);
      //  }
      //  for (int p=0; p < db.size(); ++p) {
      //    Integer cur_index(32, p, ALICE);
      //    Bit won = min_index == cur_index;
      //    allocs[p].If(won, allocs[p]+one);
      //    costs[p].If(won, costs[p] + min_cost);
      //  }
      //}
      //for (int p=0; p<num_providers; ++p) {
      //  allocs[p].reveal<int>();
      //  costs[p].reveal<int>();
      //}


      //// Linear Program
      // 10pc -> 91296 AND gates
      //vector<Integer> tups;
      //for (int p = 0; p < num_providers; ++p) tups.push_back(zero);
      //cout << "starting point prep\n";
      //for (int i = 0; i < num_providers; ++i) {
      //  cout << " point prep for " << i << "\n";
      //  auto tups_cpy = tups;
      //  //std::swap(tups[i], request_sz);
      //  lp_pts.push_back(tups_cpy);
      //  prep_points(tups_cpy, i);
      //}
      //Integer min_cost = inf;
      //vector<Integer> min_allocs;
      //for (int p = 0; p < num_providers; ++p) min_allocs.push_back(inf);
      //for (auto const &point: lp_pts) {
      //  Integer cost = zero;
      //  for (int p=0; p<num_providers; ++p) {
      //    cost = cost + (point[p] * db[p].price);
      //  }
      //  for (int p=0; p<num_providers; ++p) {
      //    Bit is_neg = point[p] < zero;
      //    cost.If(is_neg, inf);
      //  }
      //  Bit is_min_cost = cost < min_cost;
      //  min_cost.If(is_min_cost, cost);
      //  for (int p=0; p<num_providers; ++p) {
      //    min_allocs[p].If(is_min_cost, point[p]);
      //  }
      //}
      //min_cost.reveal<int>();
      //for (int p=0; p<num_providers; ++p) {
      //  min_cost.reveal<int>();
      //}
      //lp_pts.clear();


      db.clear();

      // Close the protocol execution.
      emp::finalize_plain_prot();
    }
}
