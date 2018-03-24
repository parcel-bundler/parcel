<style lang="stylus">
font-stack = Helvetica, sans-serif
primary-color = #999
body
  font 100% font-stack
  color primary-color
</style>

<!--
<style lang="sass">
$red: red;
h1 {
  color: $red;
}
</style>
-->

<style lang="less">
@green: green;
h1 {
  color: @green;
}
</style>

<!--
<template lang="jade">
div
  h1 This is the app
  comp-a
  comp-b
</template>
!-->

<template>
  <div>
    <h1>This is the app</h1>
    <comp-a></comp-a>
    <comp-b></comp-b>
  </div>
</template>

<script lang="coffee">
module.exports =
  data: ->
    msg: 'Hello from coffee!'
</script>
