import * as React from "react"

import { Drawer as DrawerPrimitive } from "vaul"



import { cn } from "@/lib/utils"



const clearDrawerArtifacts = () => {

  if (typeof document === "undefined") {

    return

  }



  const elements = [document.documentElement, document.body, document.getElementById("root")].filter(

    (element): element is HTMLElement => Boolean(element)

  )



  for (const element of elements) {

    element.style.removeProperty("overflow")

    element.style.removeProperty("height")

    element.style.removeProperty("position")

    element.style.removeProperty("touch-action")

    element.style.removeProperty("overscroll-behavior")

  }



  const drawerWrappers = document.querySelectorAll<HTMLElement>("[data-vaul-drawer-wrapper], [vaul-drawer-wrapper], [data-vaul-wrapper]")

  drawerWrappers.forEach((element) => {

    element.style.removeProperty("transform")

    element.style.removeProperty("transform-origin")

    element.style.removeProperty("transition")

    element.style.removeProperty("height")

    element.style.removeProperty("overflow")

    element.style.removeProperty("will-change")

    element.style.removeProperty("border-radius")

  })

}



const Drawer = ({

  shouldScaleBackground = false,

  open,

  ...props

}: React.ComponentProps<typeof DrawerPrimitive.Root>) => {

  React.useEffect(() => {

    if (open) {

      return

    }



    const cleanup = () => {

      clearDrawerArtifacts()

      if (typeof window !== "undefined") {

        document.documentElement.style.setProperty(

          "--app-safe-viewport-height",

          `${window.innerHeight}px`

        )

      }

    }



    cleanup()

    const frame = window.requestAnimationFrame(cleanup)

    const timeout = window.setTimeout(cleanup, 240)



    return () => {

      window.cancelAnimationFrame(frame)

      window.clearTimeout(timeout)

    }

  }, [open])



  React.useEffect(() => {

    return () => {

      clearDrawerArtifacts()

    }

  }, [])



  return (

    <DrawerPrimitive.Root

      repositionInputs={false}

      shouldScaleBackground={shouldScaleBackground}

      open={open}

      {...props}

    />

  )

}

Drawer.displayName = "Drawer"



const DrawerTrigger = DrawerPrimitive.Trigger



const DrawerPortal = DrawerPrimitive.Portal



const DrawerClose = DrawerPrimitive.Close



const DrawerOverlay = React.forwardRef<

  React.ElementRef<typeof DrawerPrimitive.Overlay>,

  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>

>(({ className, ...props }, ref) => (

  <DrawerPrimitive.Overlay

    ref={ref}

    className={cn("fixed inset-0 z-50 bg-black/80", className)}

    {...props}

  />

))

DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName



const DrawerContent = React.forwardRef<

  React.ElementRef<typeof DrawerPrimitive.Content>,

  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content>

>(({ className, children, style, ...props }, ref) => {

  return (

    <DrawerPortal>

      <DrawerOverlay />

      <DrawerPrimitive.Content

        ref={ref}

        className={cn(

          "fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto min-h-0 flex-col overflow-hidden rounded-t-[20px] border bg-background overscroll-contain",

          className

        )}

        style={{

          maxHeight: "calc(var(--app-viewport-height, 100vh) * 0.9)",

          ...style,

        }}

        {...props}

      >

        <div className="mx-auto mt-3 h-2 w-[72px] rounded-full bg-muted" />

        {children}

      </DrawerPrimitive.Content>

    </DrawerPortal>

  )

})

DrawerContent.displayName = "DrawerContent"



const DrawerHeader = ({

  className,

  ...props

}: React.HTMLAttributes<HTMLDivElement>) => (

  <div

    className={cn("grid gap-1.5 p-4 text-center sm:text-left", className)}

    {...props}

  />

)

DrawerHeader.displayName = "DrawerHeader"



const DrawerFooter = ({

  className,

  ...props

}: React.HTMLAttributes<HTMLDivElement>) => (

  <div

    className={cn("mt-auto flex flex-col gap-2 p-4", className)}

    {...props}

  />

)

DrawerFooter.displayName = "DrawerFooter"



const DrawerTitle = React.forwardRef<

  React.ElementRef<typeof DrawerPrimitive.Title>,

  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>

>(({ className, ...props }, ref) => (

  <DrawerPrimitive.Title

    ref={ref}

    className={cn(

      "text-lg font-semibold leading-none tracking-tight",

      className

    )}

    {...props}

  />

))

DrawerTitle.displayName = DrawerPrimitive.Title.displayName



const DrawerDescription = React.forwardRef<

  React.ElementRef<typeof DrawerPrimitive.Description>,

  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>

>(({ className, ...props }, ref) => (

  <DrawerPrimitive.Description

    ref={ref}

    className={cn("text-sm text-muted-foreground", className)}

    {...props}

  />

))

DrawerDescription.displayName = DrawerPrimitive.Description.displayName



export {

  Drawer,

  DrawerPortal,

  DrawerOverlay,

  DrawerTrigger,

  DrawerClose,

  DrawerContent,

  DrawerHeader,

  DrawerFooter,

  DrawerTitle,

  DrawerDescription,

}

