<style lang="stylus">
font-stack = Helvetica, sans-serif
primary-color = #999
body
  font 100% font-stack
  color primary-color
</style>

<style lang="scss">
$red: red;
h1 {
  background: $red;
}
</style>

<style lang="less">
@green: green;
h1 {
  color: @green;
}
</style>

<template lang="jade">
div
  h1 This is the app
  comp-a
  comp-b
</template>

<script lang="coffee">
module.exports =
  data: ->
    msg: 'Hello from coffee!'
</script>
