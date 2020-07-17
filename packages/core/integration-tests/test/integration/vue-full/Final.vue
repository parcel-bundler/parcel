<template>
  <div :class="[$style.small, BetterModule.small]">
    Hello final!
  </div>
</template>
<style src="./Final.module.css">
</style>
<style module="BetterModule">
.small {
  font-size: 80%;
}
</style>
<style scoped>
div {
  border: 1px solid black;
}
</style>