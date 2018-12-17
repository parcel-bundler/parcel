<template lang="html">
  <div>
    test component start:
    <component :is="compName" />
    end.
  </div>
</template>

<script>
  export default {
    components: { InsideComp: () => import('./insidecomp') },
    props: [ 'compName' ]
  }
</script>