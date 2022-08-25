cmake_minimum_required (VERSION 3.10)
project (agmpc_matcher)
set(NAME "agmpc_matcher")

cmake_policy(SET CMP0042 NEW)
set (CMAKE_CXX_STANDARD 17)

if( NODE_RUNTIMEVERSION VERSION_GREATER_EQUAL "17.0.0")
  add_compile_definitions(OPENSSL_API_COMPAT=0x10100001L)
  add_compile_definitions(OPENSSL_CONFIGURED_API=0x30000000L)
endif()

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)


#add_compile_options(-fsanitize=address)
#add_link_options(-fsanitize=address)
#add_compile_options(-fsanitize=undefined)
#add_link_options(-fsanitize=undefined)


include(cmake/common.cmake)
include(cmake/source_of_randomness.cmake)
include(cmake/threading.cmake)

find_package(OpenSSL REQUIRED)
find_package(Boost REQUIRED COMPONENTS system)
find_package(emp-tool REQUIRED)
find_package(emp-ot REQUIRED)
#find_package(emp-sh2pc REQUIRED)
#find_package(emp-agmpc REQUIRED)
find_package(GMP REQUIRED)

set(EMP-TOOL_LIBRARIES
  ${EMP-TOOL_LIBRARY}
  ${OPENSSL_LIBRARIES}
  ${Boost_LIBRARIES}
  ${GMP_LIBRARIES})

set(EMP_INCLUDE_DIRS
  ${EMP-TOOL_INCLUDE_DIR}
  ${EMP-OT_INCLUDE_DIRS}
  ${OPENSSL_INCLUDE_DIR}
  ${Boost_INCLUDE_DIRS}
  ${GMP_INCLUDE_DIR})

file(GLOB AGMPC_SINGLEATT_SOURCES
    "src/mpc_addon/agmpc_matcher.cc"
    "src/mpc_addon/agmpc_matcher.h")

add_definitions(-DCIRCUIT_DIR="${CMAKE_RUNTIME_OUTPUT_DIRECTORY}")

# Include Node-API wrappers
execute_process(COMMAND node -p "require('node-addon-api').include"
        WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
        OUTPUT_VARIABLE NODE_ADDON_API_DIR
        )
string(REGEX REPLACE "[\r\n\"]" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})
message(STATUS "NODE_ADDON_API_DIR is ${NODE_ADDON_API_DIR}")
#target_include_directories(agmpc_matcher PRIVATE ${NODE_ADDON_API_DIR})
add_definitions(-DNAPI_VERSION=3)
#include_directories(${CMAKE_JS_INC} "${NODE_ADDON_API_DIR}")

# AGMPC matcher lib
add_library(agmpc_matcher SHARED ${AGMPC_SINGLEATT_SOURCES})
target_link_libraries(agmpc_matcher ${EMP-TOOL_LIBRARIES})
target_include_directories(agmpc_matcher PUBLIC ${EMP_INCLUDE_DIRS} "src/mpc_addon")

# AGMPC lib napi binding
add_library(agmpc_matcher_napi SHARED
  "src/mpc_addon/agmpc_matcher_napi.cc"
  ${CMAKE_JS_SRC})
target_include_directories(agmpc_matcher_napi PUBLIC ${CMAKE_JS_INC} ${NODE_ADDON_API_DIR} "src/mpc_addon")
set_target_properties(agmpc_matcher_napi PROPERTIES PREFIX "" SUFFIX ".node")
target_link_libraries(agmpc_matcher_napi ${CMAKE_JS_LIB} agmpc_matcher)

# AGMPC matcher executable
add_executable(agmpc_matcher_main "src/mpc_addon/agmpc_matcher_main.cc")
target_link_libraries(agmpc_matcher_main agmpc_matcher)
target_include_directories(agmpc_matcher_main PUBLIC "src/mpc_addon")

# AGMPC matcher circuit generation
add_executable(agmpc_matcher_circuit_generator "src/mpc_addon/agmpc_matcher_circuit_generator.cc")
target_link_libraries(agmpc_matcher_circuit_generator ${EMP-TOOL_LIBRARIES})
target_include_directories(agmpc_matcher_circuit_generator PUBLIC ${EMP_INCLUDE_DIRS} "src/mpc_addon")

add_custom_target(agmpc_generate_circuits
  ./agmpc_matcher_circuit_generator 10
  DEPENDS agmpc_matcher_circuit_generator
  WORKING_DIRECTORY "${PROJECT_SOURCE_DIR}/build/bin"
)
add_dependencies(agmpc_matcher agmpc_generate_circuits)
add_dependencies(agmpc_matcher_main agmpc_generate_circuits)
add_dependencies(agmpc_matcher_napi agmpc_generate_circuits)
